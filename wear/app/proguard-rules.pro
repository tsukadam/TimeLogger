# Release で R8 する。Debug では minify しない。
-keep class com.timelogger.wear.LoggerTileService
-keep class com.timelogger.wear.LoggerMoreTileService
-keep class com.timelogger.wear.ExerciseSyncService
-keep class androidx.wear.tiles.** { *; }
-keep class androidx.wear.protolayout.** { *; }
-keep class androidx.health.services.** { *; }
