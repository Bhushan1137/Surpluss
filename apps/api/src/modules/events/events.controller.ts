import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiParam } from '@nestjs/swagger';
import { EventsService } from './events.service';
import { EventSortField, EventStatus, SortOrder } from '@surpluss/shared';

const VALID_SORT_FIELDS = new Set(['createdAt', 'updatedAt', 'attemptCount', 'status']);

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiOperation({ summary: 'List webhook events with filtering, sorting, and pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: EventStatus })
  @ApiQuery({ name: 'type', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'updatedAt', 'attemptCount', 'status'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  async findMany(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    if (page < 1) {
      throw new BadRequestException('page must be >= 1');
    }

    if (pageSize < 1 || pageSize > 100) {
      throw new BadRequestException('pageSize must be between 1 and 100');
    }

    const validStatus = status as EventStatus | undefined;
    if (status && !Object.values(EventStatus).includes(status as EventStatus)) {
      throw new BadRequestException(`Invalid status: ${status}`);
    }

    if (sortBy && !VALID_SORT_FIELDS.has(sortBy)) {
      throw new BadRequestException(`Invalid sortBy: ${sortBy}`);
    }

    if (sortOrder && sortOrder !== 'asc' && sortOrder !== 'desc') {
      throw new BadRequestException(`Invalid sortOrder: ${sortOrder}`);
    }

    return this.eventsService.findMany({
      page,
      pageSize,
      status: validStatus,
      type: type?.trim() || undefined,
      search: search?.trim() || undefined,
      sortBy: sortBy as EventSortField | undefined,
      sortOrder: sortOrder as SortOrder | undefined,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get aggregate event statistics' })
  async getStats() {
    return this.eventsService.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get event details with attempt history' })
  @ApiParam({ name: 'id', description: 'Internal event UUID' })
  async findOne(@Param('id') id: string) {
    return this.eventsService.findOne(id);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually retry a permanently failed event',
    description: 'Only available for events with FAILED status.',
  })
  @ApiParam({ name: 'id', description: 'Internal event UUID' })
  async retry(@Param('id') id: string) {
    const event = await this.eventsService.retryFailedEvent(id);
    return { success: true, message: 'Event queued for retry', data: event };
  }
}
