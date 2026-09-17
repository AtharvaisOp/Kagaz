import type {
  EditorHistoryDomain,
  EditorHistoryEntityId,
  EditorHistoryParticipant,
} from '../types';

type Participants = Partial<
  Record<EditorHistoryDomain, EditorHistoryParticipant>
>;

interface TimelineEntry {
  readonly domain: EditorHistoryDomain;
  readonly affectedEntityIds?: readonly EditorHistoryEntityId[];
}

export class EditorHistoryTimeline {
  private entries: TimelineEntry[] = [];
  private cursor = 0;
  private participants: Participants = {};

  bind(participants: Participants): void {
    this.participants = participants;
  }

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.entries.length;
  }

  record(
    domain: EditorHistoryDomain,
    affectedEntityIds?: readonly EditorHistoryEntityId[],
  ): void {
    if (this.cursor < this.entries.length) {
      this.entries = this.entries.slice(0, this.cursor);
      this.participants.annotation?.discardFuture();
      this.participants.form?.discardFuture();
    }
    this.entries.push({ domain, affectedEntityIds });
    this.cursor = this.entries.length;
  }

  undo(): boolean {
    while (this.cursor > 0) {
      const entry = this.entries[this.cursor - 1];
      const domain = entry?.domain;
      const participant = domain ? this.participants[domain] : undefined;
      if (participant?.canUndo && participant.undo()) {
        this.cursor -= 1;
        return true;
      }
      this.entries.splice(this.cursor - 1, 1);
      this.cursor -= 1;
    }
    return false;
  }

  redo(): boolean {
    while (this.cursor < this.entries.length) {
      const entry = this.entries[this.cursor];
      const domain = entry?.domain;
      const participant = domain ? this.participants[domain] : undefined;
      if (participant?.canRedo && participant.redo()) {
        this.cursor += 1;
        return true;
      }
      this.entries.splice(this.cursor, 1);
    }
    return false;
  }

  pruneDomain(
    domain: EditorHistoryDomain,
    removedEntityIds?: readonly EditorHistoryEntityId[],
  ): void {
    const removed = removedEntityIds && new Set(removedEntityIds);
    const shouldRemove = (entry: TimelineEntry) => {
      if (entry.domain !== domain) return false;
      if (!removed) return true;
      if (!entry.affectedEntityIds) return true;
      return entry.affectedEntityIds.some((id) => removed.has(id));
    };
    const removedBeforeCursor = this.entries
      .slice(0, this.cursor)
      .filter(shouldRemove).length;
    this.entries = this.entries.filter((entry) => !shouldRemove(entry));
    this.cursor = Math.max(0, this.cursor - removedBeforeCursor);
  }

  reset(): void {
    this.entries = [];
    this.cursor = 0;
  }
}
