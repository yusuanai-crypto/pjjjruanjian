package com.gzjiangjiuguan.employee

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.WindowManager
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import kotlin.math.max
import kotlin.math.roundToInt

class MainActivity : FlutterActivity() {
    private val channelName = "com.jiangjiu/attachments"
    private val secureScreenChannelName = "com.jiangjiu/sensitive_screen"
    private val maxFileSizeBytes = 10L * 1024L * 1024L
    private val maxRequestSizeBytes = 24L * 1024L * 1024L
    private val maxFileCount = 5
    private val orphanRetentionMilliseconds = 24L * 60L * 60L * 1000L
    private val maxHeicDimension = 4096
    private val worker = Executors.newSingleThreadExecutor()
    private val pendingIntents = mutableListOf<IncomingIntent>()
    private var attachmentChannel: MethodChannel? = null
    private var secureScreenChannel: MethodChannel? = null

    private data class IncomingIntent(
        val intent: Intent,
        val coldStart: Boolean,
    )

    private data class IncomingCopyState(
        var totalBytes: Long = 0L,
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enqueueIncomingIntent(intent, coldStart = true)
        worker.execute {
            cleanupOrphanedPrivateFiles(File(cacheDir, "incoming"))
            cleanupOrphanedPrivateFiles(File(cacheDir, "converted"))
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        attachmentChannel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            channelName,
        ).also { channel ->
            channel.setMethodCallHandler { call, result ->
                when (call.method) {
                    "takeIncomingFiles" -> takeIncomingFiles(result)
                    "convertHeicToJpeg" -> convertHeicToJpeg(call, result)
                    "openFile" -> openFile(call, result)
                    else -> result.notImplemented()
                }
            }
        }
        secureScreenChannel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            secureScreenChannelName,
        ).also { channel ->
            channel.setMethodCallHandler { call, result ->
                when (call.method) {
                    "enableSecureScreen" -> {
                        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                        result.success(null)
                    }
                    "disableSecureScreen" -> {
                        window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        enqueueIncomingIntent(intent, coldStart = false)
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        attachmentChannel?.setMethodCallHandler(null)
        attachmentChannel = null
        secureScreenChannel?.setMethodCallHandler(null)
        secureScreenChannel = null
        super.cleanUpFlutterEngine(flutterEngine)
    }

    override fun onDestroy() {
        worker.shutdown()
        super.onDestroy()
    }

    private fun enqueueIncomingIntent(intent: Intent?, coldStart: Boolean) {
        if (intent == null || !isSupportedIncomingAction(intent.action)) {
            return
        }
        synchronized(pendingIntents) {
            pendingIntents.add(IncomingIntent(Intent(intent), coldStart))
        }
        attachmentChannel?.invokeMethod("incomingFilesAvailable", null)
    }

    private fun isSupportedIncomingAction(action: String?): Boolean {
        return action == Intent.ACTION_SEND || action == Intent.ACTION_VIEW
    }

    private fun takeIncomingFiles(result: MethodChannel.Result) {
        val queued = synchronized(pendingIntents) {
            val snapshot = pendingIntents.toList()
            pendingIntents.clear()
            snapshot
        }
        if (worker.isShutdown) {
            result.error(
                "ATTACHMENT_WORKER_UNAVAILABLE",
                "附件处理页面已关闭。",
                null,
            )
            return
        }
        try {
            worker.execute {
                val files = mutableListOf<Map<String, Any>>()
                val errors = mutableListOf<String>()
                val copyState = IncomingCopyState()
                for (incoming in queued) {
                    copyIncomingFiles(incoming, files, errors, copyState)
                }
                runOnUiThread {
                    result.success(
                        mapOf(
                            "files" to files,
                            "errors" to errors,
                        ),
                    )
                }
            }
        } catch (_: RejectedExecutionException) {
            result.error(
                "ATTACHMENT_WORKER_UNAVAILABLE",
                "附件处理页面已关闭。",
                null,
            )
        }
    }

    private fun copyIncomingFiles(
        incoming: IncomingIntent,
        files: MutableList<Map<String, Any>>,
        errors: MutableList<String>,
        copyState: IncomingCopyState,
    ) {
        val sourceIntent = incoming.intent
        val uris = linkedSetOf<Uri>()
        if (sourceIntent.action == Intent.ACTION_VIEW) {
            sourceIntent.data?.let(uris::add)
        } else if (sourceIntent.action == Intent.ACTION_SEND) {
            val stream = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                sourceIntent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            } else {
                @Suppress("DEPRECATION")
                sourceIntent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
            }
            stream?.let(uris::add)
            sourceIntent.clipData?.let { clip ->
                for (index in 0 until clip.itemCount) {
                    clip.getItemAt(index).uri?.let(uris::add)
                }
            }
        }
        if (uris.isEmpty()) {
            errors.add("没有收到可读取的微信附件。")
            return
        }
        if (uris.size > maxFileCount) {
            errors.add("一次最多导入${maxFileCount}个文件。")
            return
        }

        for (uri in uris) {
            if (files.size >= maxFileCount) {
                errors.add("一次最多导入${maxFileCount}个文件。")
                break
            }
            var copiedDirectory: File? = null
            var accepted = false
            try {
                if (uri.scheme != "content") {
                    errors.add("仅支持由微信安全授权的文件地址。")
                    continue
                }
                val originalName = queryDisplayName(uri)
                val safeName = sanitizeFileName(originalName)
                val mimeType = (
                    contentResolver.getType(uri) ?: sourceIntent.type ?: ""
                ).substringBefore(';').lowercase()
                if (!isSupportedOfficeAttachment(safeName, mimeType)) {
                    errors.add("“$safeName”格式或MIME类型不受支持。")
                    continue
                }
                val incomingDirectory = File(
                    cacheDir,
                    "incoming/${UUID.randomUUID()}",
                )
                copiedDirectory = incomingDirectory
                if (!incomingDirectory.mkdirs()) {
                    throw IllegalStateException("无法创建附件临时目录")
                }
                setOwnerOnlyPermissions(incomingDirectory)
                val target = File(
                    incomingDirectory,
                    ".incoming-${UUID.randomUUID()}",
                )
                var total = 0L
                contentResolver.openInputStream(uri).use { input ->
                    if (input == null) {
                        throw IllegalStateException("无法读取文件")
                    }
                    FileOutputStream(target).use { output ->
                        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            total += read
                            if (total > maxFileSizeBytes) {
                                throw FileTooLargeException()
                            }
                            if (
                                copyState.totalBytes + total >
                                maxRequestSizeBytes
                            ) {
                                throw RequestTooLargeException()
                            }
                            output.write(buffer, 0, read)
                        }
                    }
                    if (total == 0L) {
                        throw EmptyFileException()
                    }
                    copyState.totalBytes += total
                }
                setOwnerOnlyPermissions(target)
                files.add(
                    mapOf(
                        "path" to target.absolutePath,
                        "fileName" to safeName,
                        "mimeType" to mimeType,
                        "coldStart" to incoming.coldStart,
                    ),
                )
                accepted = true
            } catch (_: FileTooLargeException) {
                errors.add("“${queryDisplayName(uri)}”超过10MB，已拒绝导入。")
            } catch (_: RequestTooLargeException) {
                errors.add("本次导入文件总大小超过24MB，已停止导入。")
            } catch (_: EmptyFileException) {
                errors.add("不能导入空文件。")
            } catch (_: SecurityException) {
                errors.add("微信没有授予“${queryDisplayName(uri)}”的临时读取权限。")
            } catch (_: Exception) {
                errors.add("复制“${queryDisplayName(uri)}”失败，请重新导入。")
            } finally {
                if (!accepted) {
                    copiedDirectory?.deleteRecursively()
                }
            }
        }
    }

    private fun queryDisplayName(uri: Uri): String {
        contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME),
            null,
            null,
            null,
        )?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0 && cursor.moveToFirst()) {
                return cursor.getString(index) ?: "attachment"
            }
        }
        return uri.lastPathSegment ?: "attachment"
    }

    private fun sanitizeFileName(value: String): String {
        val baseName = value.replace('\\', '/').substringAfterLast('/').trim()
        val sanitized = baseName
            .replace(Regex("[\\u0000-\\u001f\\u007f<>:\"/\\\\|?*]"), "_")
            .trim()
        return (sanitized.ifBlank { "attachment" }).take(180)
    }

    private fun isSupportedOfficeAttachment(
        fileName: String,
        mimeType: String,
    ): Boolean {
        val extension = fileName.substringAfterLast('.', "").lowercase()
        return when (extension) {
            "pdf" -> mimeType == "application/pdf"
            "doc" -> mimeType == "application/msword"
            "docx" ->
                mimeType ==
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            "xls" -> mimeType == "application/vnd.ms-excel"
            "xlsx" ->
                mimeType ==
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            else -> false
        }
    }

    private fun convertHeicToJpeg(
        call: MethodCall,
        result: MethodChannel.Result,
    ) {
        val sourcePath = call.argument<String>("path")
        val originalName = call.argument<String>("fileName") ?: "photo.heic"
        if (sourcePath.isNullOrBlank()) {
            result.error("HEIC_PATH_MISSING", "HEIC/HEIF照片缺少本地路径。", null)
            return
        }
        if (worker.isShutdown) {
            result.error(
                "HEIC_CONVERSION_FAILED",
                "HEIC/HEIF照片处理页面已关闭。",
                null,
            )
            return
        }
        try {
            worker.execute {
                var bitmap: Bitmap? = null
                var outputDirectory: File? = null
                var keepOutput = false
                try {
                    val source = File(sourcePath)
                    if (!source.isFile) {
                        throw IllegalStateException("照片文件不存在")
                    }
                    val decodedBitmap = decodeHeicBitmap(source)
                        ?: throw IllegalStateException("无法解码HEIC/HEIF照片")
                    bitmap = decodedBitmap
                    val createdOutputDirectory = File(
                        cacheDir,
                        "converted/${UUID.randomUUID()}",
                    )
                    outputDirectory = createdOutputDirectory
                    if (!createdOutputDirectory.mkdirs()) {
                        throw IllegalStateException("无法创建照片临时目录")
                    }
                    setOwnerOnlyPermissions(createdOutputDirectory)
                    val stem = originalName.substringBeforeLast('.', originalName)
                    val outputName = "${sanitizeFileName(stem)}.jpg"
                    val output = File(
                        createdOutputDirectory,
                        ".converted-${UUID.randomUUID()}",
                    )
                    FileOutputStream(output).use { stream ->
                        if (!decodedBitmap.compress(
                                Bitmap.CompressFormat.JPEG,
                                95,
                                stream,
                            )
                        ) {
                            throw IllegalStateException("JPEG编码失败")
                        }
                    }
                    setOwnerOnlyPermissions(output)
                    if (output.length() > maxFileSizeBytes) {
                        throw FileTooLargeException()
                    }
                    keepOutput = true
                    runOnUiThread {
                        result.success(
                            mapOf(
                                "path" to output.absolutePath,
                                "fileName" to outputName,
                                "width" to decodedBitmap.width,
                                "height" to decodedBitmap.height,
                            ),
                        )
                    }
                } catch (_: OutOfMemoryError) {
                    runOnUiThread {
                        result.error(
                            "HEIC_OUT_OF_MEMORY",
                            "HEIC/HEIF照片尺寸过大，设备内存不足，已停止转换。",
                            null,
                        )
                    }
                } catch (_: FileTooLargeException) {
                    runOnUiThread {
                        result.error(
                            "CONVERTED_FILE_TOO_LARGE",
                            "转换后的JPEG照片超过10MB。",
                            null,
                        )
                    }
                } catch (_: Exception) {
                    runOnUiThread {
                        result.error(
                            "HEIC_CONVERSION_FAILED",
                            "HEIC/HEIF照片转换失败，请重新选择。",
                            null,
                        )
                    }
                } finally {
                    bitmap?.let {
                        if (!it.isRecycled) {
                            it.recycle()
                        }
                    }
                    if (!keepOutput) {
                        outputDirectory?.deleteRecursively()
                    }
                }
            }
        } catch (_: OutOfMemoryError) {
            result.error(
                "HEIC_OUT_OF_MEMORY",
                "HEIC/HEIF照片尺寸过大，设备内存不足，已停止转换。",
                null,
            )
        } catch (_: RejectedExecutionException) {
            result.error(
                "HEIC_CONVERSION_FAILED",
                "HEIC/HEIF照片处理页面已关闭。",
                null,
            )
        }
    }

    private fun decodeHeicBitmap(source: File): Bitmap? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return ImageDecoder.decodeBitmap(
                ImageDecoder.createSource(source),
            ) { decoder, info, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                val target = calculateTargetSize(
                    info.size.width,
                    info.size.height,
                )
                if (target.width != info.size.width ||
                    target.height != info.size.height
                ) {
                    decoder.setTargetSize(target.width, target.height)
                }
            }
        }

        val bounds = BitmapFactory.Options().apply {
            inJustDecodeBounds = true
        }
        BitmapFactory.decodeFile(source.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            return null
        }
        val target = calculateTargetSize(bounds.outWidth, bounds.outHeight)
        var sampleSize = 1
        while (
            divideRoundingUp(bounds.outWidth, sampleSize) > target.width ||
            divideRoundingUp(bounds.outHeight, sampleSize) > target.height
        ) {
            sampleSize *= 2
        }
        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleSize
        }
        var bitmap = BitmapFactory.decodeFile(source.absolutePath, options)
            ?: return null
        try {
            if (bitmap.width > target.width || bitmap.height > target.height) {
                val scaled = Bitmap.createScaledBitmap(
                    bitmap,
                    target.width,
                    target.height,
                    true,
                )
                if (scaled !== bitmap) {
                    bitmap.recycle()
                    bitmap = scaled
                }
            }
            val orientation = ExifInterface(source).getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL,
            )
            val degrees = when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
            if (degrees == 0f) {
                return bitmap
            }
            val matrix = Matrix().apply { postRotate(degrees) }
            val rotated = Bitmap.createBitmap(
                bitmap,
                0,
                0,
                bitmap.width,
                bitmap.height,
                matrix,
                true,
            )
            if (rotated !== bitmap) {
                bitmap.recycle()
            }
            return rotated
        } catch (error: Throwable) {
            if (!bitmap.isRecycled) {
                bitmap.recycle()
            }
            throw error
        }
    }

    private fun calculateTargetSize(width: Int, height: Int): BitmapSize {
        if (width <= 0 || height <= 0) {
            throw IllegalArgumentException("无效的图片尺寸")
        }
        val longestEdge = max(width, height)
        if (longestEdge <= maxHeicDimension) {
            return BitmapSize(width, height)
        }
        val scale = maxHeicDimension.toDouble() / longestEdge.toDouble()
        return BitmapSize(
            width = (width * scale).roundToInt().coerceAtLeast(1),
            height = (height * scale).roundToInt().coerceAtLeast(1),
        )
    }

    private fun divideRoundingUp(value: Int, divisor: Int): Int {
        return (
            (value.toLong() + divisor.toLong() - 1L) / divisor.toLong()
        ).toInt()
    }

    private fun openFile(call: MethodCall, result: MethodChannel.Result) {
        val filePath = call.argument<String>("path")
        val mimeType = call.argument<String>("mimeType")
        if (filePath.isNullOrBlank() || mimeType.isNullOrBlank()) {
            result.success(mapOf("status" to "failed", "message" to "附件参数不完整。"))
            return
        }
        val file = File(filePath)
        if (!file.isFile) {
            result.success(mapOf("status" to "missing_file"))
            return
        }
        try {
            val contentUri = FileProvider.getUriForFile(
                this,
                "$packageName.fileprovider",
                file,
            )
            val viewIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(contentUri, mimeType)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                clipData = ClipData.newRawUri(file.name, contentUri)
            }
            if (viewIntent.resolveActivity(packageManager) == null) {
                result.success(mapOf("status" to "no_application"))
                return
            }
            startActivity(Intent.createChooser(viewIntent, "用其他应用打开"))
            result.success(mapOf("status" to "opened"))
        } catch (_: ActivityNotFoundException) {
            result.success(mapOf("status" to "no_application"))
        } catch (_: Exception) {
            result.success(
                mapOf(
                    "status" to "failed",
                    "message" to "打开附件失败，请稍后重试。",
                ),
            )
        }
    }

    private data class BitmapSize(
        val width: Int,
        val height: Int,
    )

    private class FileTooLargeException : Exception()

    private class RequestTooLargeException : Exception()

    private class EmptyFileException : Exception()

    private fun setOwnerOnlyPermissions(file: File) {
        file.setReadable(false, false)
        file.setWritable(false, false)
        file.setExecutable(false, false)
        file.setReadable(true, true)
        file.setWritable(true, true)
        if (file.isDirectory) {
            file.setExecutable(true, true)
        }
    }

    private fun cleanupOrphanedPrivateFiles(root: File) {
        val cutoff = System.currentTimeMillis() - orphanRetentionMilliseconds
        val children = root.listFiles() ?: return
        for (candidate in children) {
            if (
                candidate.parentFile == root &&
                candidate.lastModified() in 1 until cutoff
            ) {
                candidate.deleteRecursively()
            }
        }
    }
}
