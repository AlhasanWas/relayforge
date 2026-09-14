import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { type Page, pageArgs, toPage } from '../http/pagination';
import {
  type ListRejectedAttemptsQueryDto,
  type RejectedAttemptResponse,
  toRejectedAttemptResponse,
} from './rejected-attempt.dto';

@Injectable()
export class RejectedAttemptsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    workspaceId: string,
    query: ListRejectedAttemptsQueryDto,
  ): Promise<Page<RejectedAttemptResponse>> {
    const args = pageArgs(query);
    const rows = await this.prisma.rejectedWebhookAttempt.findMany({
      ...args,
      where: {
        ...args.where,
        workspaceId,
        reason: query.reason,
        providerConnectionId: query.providerConnectionId,
      },
    });
    return toPage(rows, query, toRejectedAttemptResponse);
  }
}
