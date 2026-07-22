import { Module } from '@nestjs/common';
import { HealthController } from './api/health/health.controller.js';
import { MarketController } from './api/market/market.controller.js';
import { MarketSearchService } from './application/market/market-search.service.js';
import { AppConfigModule } from './infrastructure/config/app-config.module.js';
import { createAssetSearch } from './market/search.js';

@Module({
  imports: [AppConfigModule],
  controllers: [HealthController, MarketController],
  providers: [{
    provide: MarketSearchService,
    useFactory: () => new MarketSearchService(createAssetSearch())
  }]
})
export class AppModule {}
