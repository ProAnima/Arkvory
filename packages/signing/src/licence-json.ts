/**
 * JSON of licence documents read as untrusted input. `JSON.parse` keeps the last of two equal
 * keys, while the hub and other readers refuse such a text: one signed document would then mean
 * different things to different readers. This scanner walks the text once, refuses a repeated
 * key in any object and nesting deeper than `MAX_DEPTH`, and only then hands the text to
 * `JSON.parse`, which owns the decoding of values.
 */
const MAX_DEPTH = 16;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const STRING = /"(?:[^"\\]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
const LITERAL = /true|false|null/y;
const SPACE = /[ \t\n\r]*/y;

class Scanner {
  position = 0;
  constructor(private readonly text: string) {}

  fail(): never {
    throw new SyntaxError('Invalid licence JSON');
  }

  skip(): void {
    SPACE.lastIndex = this.position;
    SPACE.exec(this.text);
    this.position = SPACE.lastIndex;
  }

  token(pattern: RegExp): string | null {
    pattern.lastIndex = this.position;
    const match = pattern.exec(this.text);
    if (match === null) return null;
    // A raw control character is not allowed inside a JSON string.
    if (pattern === STRING)
      for (let index = 0; index < match[0].length; index++)
        if (match[0].charCodeAt(index) < 0x20) this.fail();
    this.position = pattern.lastIndex;
    return match[0];
  }

  expect(character: string): void {
    this.skip();
    if (this.text[this.position] !== character) this.fail();
    this.position++;
  }

  value(depth: number): void {
    if (depth > MAX_DEPTH) this.fail();
    this.skip();
    const next = this.text[this.position];
    if (next === '{') {
      this.object(depth);
      return;
    }
    if (next === '[') {
      this.array(depth);
      return;
    }
    if (this.token(STRING) ?? this.token(NUMBER) ?? this.token(LITERAL)) return;
    this.fail();
  }

  object(depth: number): void {
    this.position++;
    const keys = new Set<string>();
    this.skip();
    if (this.text[this.position] === '}') {
      this.position++;
      return;
    }
    for (;;) {
      this.skip();
      const raw = this.token(STRING) ?? this.fail();
      const key = String(JSON.parse(raw));
      if (keys.has(key)) this.fail();
      keys.add(key);
      this.expect(':');
      this.value(depth + 1);
      this.skip();
      const separator = this.text[this.position++];
      if (separator === '}') return;
      if (separator !== ',') this.fail();
    }
  }

  array(depth: number): void {
    this.position++;
    this.skip();
    if (this.text[this.position] === ']') {
      this.position++;
      return;
    }
    for (;;) {
      this.value(depth + 1);
      this.skip();
      const separator = this.text[this.position++];
      if (separator === ']') return;
      if (separator !== ',') this.fail();
    }
  }
}

/** The value of a JSON text with unique keys; any other text throws a SyntaxError. */
export function strictJson(text: string): unknown {
  const scanner = new Scanner(text);
  scanner.value(0);
  scanner.skip();
  if (scanner.position !== text.length) scanner.fail();
  return JSON.parse(text) as unknown;
}
