import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")

if (!keystorePropertiesFile.isFile) {
    throw GradleException(
        "Missing android/key.properties. Release signing must never fall back to a debug key.",
    )
}

keystorePropertiesFile.inputStream().use {
    keystoreProperties.load(it)
}

fun requiredSigningProperty(name: String): String {
    val value = keystoreProperties.getProperty(name)
    if (value.isNullOrEmpty()) {
        throw GradleException("Missing required release signing property: $name")
    }
    return value
}

val releaseKeystoreFile = file(requiredSigningProperty("storeFile"))
if (!releaseKeystoreFile.isFile) {
    throw GradleException("The configured release keystore file does not exist.")
}

android {
    namespace = "com.gzjiangjiuguan.employee"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.gzjiangjiuguan.employee"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            storeFile = releaseKeystoreFile
            storePassword = requiredSigningProperty("storePassword")
            keyAlias = requiredSigningProperty("keyAlias")
            keyPassword = requiredSigningProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isDebuggable = false
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    implementation("androidx.exifinterface:exifinterface:1.4.1")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}
