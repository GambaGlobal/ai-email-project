import type {
  EnsureLabelRequest,
  EnsureLabelResponse,
  GetThreadRequest,
  GetThreadResponse,
  ListChangesRequest,
  ListChangesResponse,
  ModifyThreadLabelsRequest,
  MailProvider,
  MailProviderContext,
  UpsertThreadDraftRequest,
  UpsertThreadDraftResponse
} from "@ai-email/shared";
import { NotImplementedError } from "./errors";

const notImplemented = (method: string): never => {
  throw new NotImplementedError(
    `GmailProvider.${method} not implemented (Step 2.8 stub)`
  );
};

export class GmailProvider implements MailProvider {
  kind: MailProvider["kind"] = "gmail";

  async listChanges(
    _context: MailProviderContext,
    _req: ListChangesRequest
  ): Promise<ListChangesResponse> {
    notImplemented("listChanges");
  }

  async getThread(
    _context: MailProviderContext,
    _req: GetThreadRequest
  ): Promise<GetThreadResponse> {
    notImplemented("getThread");
  }

  async ensureLabel(
    _context: MailProviderContext,
    _req: EnsureLabelRequest
  ): Promise<EnsureLabelResponse> {
    notImplemented("ensureLabel");
  }

  async modifyThreadLabels(
    _context: MailProviderContext,
    _req: ModifyThreadLabelsRequest
  ): Promise<void> {
    notImplemented("modifyThreadLabels");
  }

  async upsertThreadDraft(
    _context: MailProviderContext,
    _req: UpsertThreadDraftRequest
  ): Promise<UpsertThreadDraftResponse> {
    notImplemented("upsertThreadDraft");
  }
}
