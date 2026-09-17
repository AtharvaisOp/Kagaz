import type { EditorHistoryDomain, EditorHistoryParticipant } from '../types';

type Participants = Partial<
  Record<EditorHistoryDomain, EditorHistoryParticipant>
>;

export class EditorHistoryTimeline {
  private entries: EditorHistoryDomain[] = [];
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

  record(domain: EditorHistoryDomain): void {
    if (this.cursor < this.entries.length) {
      this.entries = this.entries.slice(0, this.cursor);
      this.participants.annotation?.discardFuture();
      this.participants.form?.discardFuture();
    }
    this.entries.push(domain);
    this.cursor = this.entries.length;
  }

  undo(): boolean {
    while (this.cursor > 0) {
      const domain = this.entries[this.cursor - 1];
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
      const domain = this.entries[this.cursor];
      const participant = domain ? this.participants[domain] : undefined;
      if (participant?.canRedo && participant.redo()) {
        this.cursor += 1;
        return true;
      }
      this.entries.splice(this.cursor, 1);
    }
    return false;
  }

  pruneDomain(domain: EditorHistoryDomain): void {
    const removedBeforeCursor = this.entries
      .slice(0, this.cursor)
      .filter((entry) => entry === domain).length;
    this.entries = this.entries.filter((entry) => entry !== domain);
    this.cursor = Math.max(0, this.cursor - removedBeforeCursor);
  }

  reset(): void {
    this.entries = [];
    this.cursor = 0;
  }
}
