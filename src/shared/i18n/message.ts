// What a catalog entry is: a sentence with `{name}` slots, or its plural forms.

/** A sentence, or one per plural category (`Intl.PluralRules`); `other` is always there. */
export type Message = string | PluralMessage;
export interface PluralMessage {
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

/** What fills a sentence's `{slots}`. A plural message picks its form by `count`. */
export type Params = Readonly<Record<string, string | number>>;

export type Catalog = Readonly<Record<string, Message>>;
