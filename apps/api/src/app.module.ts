import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './modules/prisma/prisma.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { EventsModule } from './modules/events/events.module';
import { HealthController } from './health.controller';
import appConfig from './config/app.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: ['.env.local', '.env'],
    }),
    PrismaModule,
    WebhooksModule,
    EventsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
