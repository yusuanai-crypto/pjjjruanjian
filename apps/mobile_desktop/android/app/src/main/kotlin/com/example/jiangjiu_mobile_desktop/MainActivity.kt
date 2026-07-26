package com.example.jiangjiu_mobile_desktop

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
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

class MainActivity : FlutterActivity() {
    private val channelName = "com.jiangjiu/attachments"
    private val maxFileSizeBytes = 10L * 1024L * 1024L
    private val worker = Executors.newSingleThreadExecutor()
    private val pendingIntents = mutableListOf<IncomingIntent>()
    private var attachmentChannel: MethodChannel? = null

    private data class IncomingIntent(
        val intent: Intent,
        val coldStart: Boolean,
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enqueueIncomingIntent(intent, coldStart = true)
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
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        enqueueIncomingIntent(intent, coldStart = false)
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        attachmentChannel?.setMethodCallHandler(null)
        attachmentChannel = null
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
        worker.execute {
            val files = mutableListOf<Map<String, Any>>()
            val errors = mutableListOf<String>()
            for (incoming in queued) {
                copyIncomingFiles(incoming, files, errors)
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
    }

    private fun copyIncomingFiles(
        incoming: IncomingIntent,
        files: MutableList<Map<String, Any>>,
        errors: MutableList<String>,
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
        if (uris.size > 5) {
            errors.add("一次最多导入5个文件。")
            return
        }

        for (uri in uris) {
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
                    sourceIntent.type ?: contentResolver.getType(uri) ?: ""
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
                val target = File(incomingDirectory, safeName)
                contentResolver.openInputStream(uri).use { input ->
                    if (input == null) {
                        throw IllegalStateException("无法读取文件")
                    }
                    FileOutputStream(target).use { output ->
                        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                        var total = 0L
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            total += read
                            if (total > maxFileSizeBytes) {
                                throw FileTooLargeException()
                            }
                            output.write(buffer, 0, read)
                        }
                    }
                }
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
        worker.execute {
            try {
                val source = File(sourcePath)
                if (!source.isFile) {
                    throw IllegalStateException("照片文件不存在")
                }
                val bitmap = decodeHeicBitmap(source)
                    ?: throw IllegalStateException("无法解码HEIC/HEIF照片")
                val outputDirectory = File(
                    cacheDir,
                    "converted/${UUID.randomUUID()}",
                )
                outputDirectory.mkdirs()
                val stem = originalName.substringBeforeLast('.', originalName)
                val output = File(
                    outputDirectory,
                    "${sanitizeFileName(stem)}.jpg",
                )
                FileOutputStream(output).use { stream ->
                    if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 95, stream)) {
                        throw IllegalStateException("JPEG编码失败")
                    }
                }
                bitmap.recycle()
                if (output.length() > maxFileSizeBytes) {
                    output.delete()
                    throw FileTooLargeException()
                }
                runOnUiThread {
                    result.success(
                        mapOf(
                            "path" to output.absolutePath,
                            "fileName" to output.name,
                        ),
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
            }
        }
    }

    private fun decodeHeicBitmap(source: File): Bitmap? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return ImageDecoder.decodeBitmap(
                ImageDecoder.createSource(source),
            ) { decoder, _, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        }
        val bitmap = BitmapFactory.decodeFile(source.absolutePath) ?: return null
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
        val matrix = android.graphics.Matrix().apply { postRotate(degrees) }
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

    private class FileTooLargeException : Exception()
}
