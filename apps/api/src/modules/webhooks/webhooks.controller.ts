import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { IngestWebhookDto } from './dto/ingest-webhook.dto';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Ingest a webhook event',
    description:
      'Accepts webhook events for async processing. Returns 202 for new and duplicate events. ' +
      'eventId is the idempotency key; duplicate payloads are silently ignored.',
  })
  @ApiResponse({ status: 202, description: 'Event accepted for processing' })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  async ingest(@Body() dto: IngestWebhookDto) {
    const result = await this.webhooksService.ingest(dto);

    return {
      success: true,
      message: result.isDuplicate
        ? 'Duplicate event received; original preserved'
        : 'Event accepted for processing',
      data: {
        id: result.id,
        eventId: result.eventId,
        status: result.status,
        duplicate: result.isDuplicate,
      },
    };
  }
}
