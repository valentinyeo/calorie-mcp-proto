plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "dev.calorie.tracker"
    compileSdk = 36
    defaultConfig {
        applicationId = "dev.calorie.tracker"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-debug"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "ORIGIN", "\"https://calorie-mcp-proto.ancient-glitter-9ac9.workers.dev\"")
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
kotlin { compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
dependencies {
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.browser:browser:1.9.0")
    implementation(platform("androidx.compose:compose-bom:2026.05.01"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
}
