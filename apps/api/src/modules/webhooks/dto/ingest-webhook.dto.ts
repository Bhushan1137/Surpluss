import { IsString, IsNotEmpty, MaxLength, IsOptional, IsObject } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IngestWebhookDto {
  @ApiProperty({
    description: 'Unique identifier for the event (idempotency key)',
    example: 'evt_01HPXYZ',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'eventId must not be empty' })
  @MaxLength(255)
  eventId!: string;

  @ApiProperty({
    description: 'Event type identifier',
    example: 'order.created',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'type must not be empty' })
  @MaxLength(255)
  type!: string;

  @ApiPropertyOptional({
    description: 'Event data payload (may include simulate field for testing)',
    example: { orderId: '12345', simulate: 'ok' },
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
