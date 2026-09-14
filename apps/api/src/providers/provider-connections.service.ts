import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { type Page, type PageQueryDto, pageArgs, toPage } from '../http/pagination';
import {
  type ProviderConnectionResponse,
  toProviderConnectionResponse,
} from './provider-connection.dto';

@Injectable()
export class ProviderConnectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, query: PageQueryDto): Promise<Page<ProviderConnectionResponse>> {
    const args = pageArgs(query);
    const rows = await this.prisma.providerConnection.findMany({
      ...args,
      where: { ...args.where, workspaceId },
      include: { providerDefinition: true },
      omit: { signingSecretEncrypted: true },
    });
    return toPage(rows, query, toProviderConnectionResponse);
  }
}
