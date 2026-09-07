import { stringValue } from './types';
// A small expression interpreter. No eval, Function, property access, or external I/O.
type Value = string | number | boolean | null;
type Token = {
  type: 'number' | 'string' | 'name' | 'operator' | 'end';
  value: string;
};
export function formula(
  expression: string,
  property: (name: string) => unknown,
): Value {
  if (expression.length > 2000) throw new Error('Formula is too long');
  const tokens: Token[] = [];
  let source = expression;
  while (source.length) {
    const ws = /^\s+/.exec(source);
    if (ws) {
      source = source.slice(ws[0].length);
      continue;
    }
    const match =
      /^(\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*|==|!=|<=|>=|&&|\|\||[()+\-*/%,<>!])/.exec(
        source,
      );
    if (!match) throw new Error('Unexpected formula character');
    const v = match[0];
    tokens.push({
      type: /^\d/.test(v)
        ? 'number'
        : /^['"]/.test(v)
          ? 'string'
          : /^[A-Za-z_]/.test(v)
            ? 'name'
            : 'operator',
      value: v,
    });
    source = source.slice(v.length);
    if (tokens.length > 300) throw new Error('Formula is too complex');
  }
  tokens.push({ type: 'end', value: '' });
  let pos = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];
  const expect = (value: string) => {
    if (take().value !== value) throw new Error(`Expected ${value}`);
  };
  const numeric = (v: Value) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('Expected a number');
    return n;
  };
  const call = (name: string, args: Value[]): Value => {
    const n = args.map((v) => Number(v));
    switch (name.toLowerCase()) {
      case 'prop': {
        const v = property(stringValue(args[0]));
        return typeof v === 'number' ||
          typeof v === 'string' ||
          typeof v === 'boolean'
          ? v
          : v === null || v === undefined
            ? null
            : JSON.stringify(v);
      }
      case 'if':
        return args[0] ? (args[1] ?? null) : (args[2] ?? null);
      case 'round':
        return Math.round(n[0] * 10 ** (n[1] || 0)) / 10 ** (n[1] || 0);
      case 'abs':
        return Math.abs(n[0]);
      case 'min':
        return Math.min(...n);
      case 'max':
        return Math.max(...n);
      case 'sum':
        return n.reduce((a, b) => a + b, 0);
      case 'average':
        return n.reduce((a, b) => a + b, 0) / n.length;
      case 'concat':
        return args.join('');
      case 'upper':
        return stringValue(args[0] ?? '').toUpperCase();
      case 'lower':
        return stringValue(args[0] ?? '').toLowerCase();
      case 'length':
        return stringValue(args[0] ?? '').length;
      case 'contains':
        return stringValue(args[0] ?? '').includes(stringValue(args[1]));
      case 'datediff':
        return (
          (Date.parse(stringValue(args[0])) -
            Date.parse(stringValue(args[1]))) /
          86400000
        );
      case 'dateadd': {
        const d = new Date(stringValue(args[0]));
        d.setUTCDate(d.getUTCDate() + n[1]);
        return d.toISOString().slice(0, 10);
      }
      case 'empty':
        return args[0] === null || args[0] === '';
      default:
        throw new Error(`Unknown function: ${name}`);
    }
  };
  const precedence: Record<string, number> = {
    '||': 1,
    '&&': 2,
    '==': 3,
    '!=': 3,
    '<': 4,
    '>': 4,
    '<=': 4,
    '>=': 4,
    '+': 5,
    '-': 5,
    '*': 6,
    '/': 6,
    '%': 6,
  };
  type Expression = () => Value;
  function expressionAt(min = 0, depth = 0): Expression {
    if (depth > 40) throw new Error('Formula nesting limit');
    const token = take();
    let left: Expression;
    if (token.type === 'number') left = () => Number(token.value);
    else if (token.type === 'string')
      left = () =>
        token.value[0] === '"'
          ? JSON.parse(token.value)
          : token.value.slice(1, -1).replace(/\\'/g, "'");
    else if (token.value === '(') {
      left = expressionAt(0, depth + 1);
      expect(')');
    } else if (['-', '!', '+'].includes(token.value)) {
      const expression = expressionAt(7, depth + 1);
      left = () => {
        const value = expression();
        return token.value === '!'
          ? !value
          : token.value === '-'
            ? -numeric(value)
            : numeric(value);
      };
    } else if (token.type === 'name') {
      if (token.value === 'true' || token.value === 'false')
        left = () => token.value === 'true';
      else if (token.value === 'null') left = () => null;
      else {
        expect('(');
        const args: Expression[] = [];
        if (peek().value !== ')')
          do {
            args.push(expressionAt(0, depth + 1));
            if (peek().value !== ',') break;
            take();
          } while (peek().type !== 'end');
        expect(')');
        left = () =>
          token.value.toLowerCase() === 'if'
            ? args[0]?.()
              ? (args[1]?.() ?? null)
              : (args[2]?.() ?? null)
            : call(
                token.value,
                args.map((arg) => arg()),
              );
      }
    } else throw new Error('Expected a value');
    while ((precedence[peek().value] || 0) > min) {
      const op = take().value;
      const first = left,
        second = expressionAt(precedence[op], depth + 1);
      left = () => {
        const value = first();
        if (op === '&&' && !value) return false;
        if (op === '||' && value) return true;
        return binary(op, value, second());
      };
    }
    return left;
  }
  function binary(op: string, left: Value, right: Value): Value {
    switch (op) {
      case '+':
        left =
          typeof left === 'string' || typeof right === 'string'
            ? stringValue(left ?? '') + stringValue(right ?? '')
            : numeric(left) + numeric(right);
        break;
      case '-':
        left = numeric(left) - numeric(right);
        break;
      case '*':
        left = numeric(left) * numeric(right);
        break;
      case '/':
        if (numeric(right) === 0) throw new Error('Division by zero');
        left = numeric(left) / numeric(right);
        break;
      case '%':
        left = numeric(left) % numeric(right);
        break;
      case '==':
        left = left === right;
        break;
      case '!=':
        left = left !== right;
        break;
      case '<':
        left = left! < right!;
        break;
      case '>':
        left = left! > right!;
        break;
      case '<=':
        left = left! <= right!;
        break;
      case '>=':
        left = left! >= right!;
        break;
      case '&&':
        left = !!left && !!right;
        break;
      case '||':
        left = !!left || !!right;
        break;
    }

    return left;
  }
  const parsedExpression = expressionAt();
  if (peek().type !== 'end')
    throw new Error('Unexpected trailing formula content');
  const result = parsedExpression();
  if (typeof result === 'number' && !Number.isFinite(result))
    throw new Error('Formula result is not finite');
  return result;
}
