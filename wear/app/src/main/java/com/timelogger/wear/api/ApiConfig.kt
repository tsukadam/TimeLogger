package com.timelogger.wear.api

import com.timelogger.wear.BuildConfig

/**
 * 実 URL は git 外の local.properties（timelogger.api.base）。
 */
object ApiConfig {
    val BASE_URL: String = BuildConfig.API_BASE_URL
}
