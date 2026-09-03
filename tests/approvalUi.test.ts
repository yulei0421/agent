import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript/unstable/ast';
import { API, type Snapshot } from 'typescript/unstable/sync';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const tsconfigPath = fileURLToPath(new URL('../tsconfig.json', import.meta.url));
const chatWindowPath = fileURLToPath(new URL('../src/components/ChatWindow.tsx', import.meta.url));
let astApi: API | undefined;
let astSnapshot: Snapshot | undefined;

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

function chatWindowAst(): ts.SourceFile {
  astApi ??= new API({ cwd: projectRoot });
  astSnapshot ??= astApi.updateSnapshot({ openProjects: [tsconfigPath] });
  const project = astSnapshot.getProject(tsconfigPath) ?? astSnapshot.getProjects()[0];
  assert.ok(project, 'expected the TypeScript project to load');
  const sourceFile = project.program.getSourceFile(chatWindowPath);
  assert.ok(sourceFile, 'expected ChatWindow.tsx in the TypeScript project');
  return sourceFile;
}

test.after(() => {
  astSnapshot?.dispose();
  astApi?.close();
});

function findNodes<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const matches: T[] = [];
  const visit = (node: ts.Node): void => {
    if (predicate(node)) matches.push(node);
    node.forEachChild(visit);
  };
  visit(root);
  return matches;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  return ts.skipOuterExpressions(expression);
}

function isIdentifier(expression: ts.Expression, name: string): boolean {
  const current = unwrapExpression(expression);
  return ts.isIdentifier(current) && current.text === name;
}

function jsxAttribute(element: ts.JsxElement, name: string): ts.JsxAttribute | undefined {
  return element.openingElement.attributes.properties.find(
    (property): property is ts.JsxAttribute => (
      ts.isJsxAttribute(property)
      && ts.isIdentifier(property.name)
      && property.name.text === name
    )
  );
}

function jsxAttributeExpression(element: ts.JsxElement, name: string): ts.Expression | undefined {
  const initializer = jsxAttribute(element, name)?.initializer;
  return initializer && ts.isJsxExpression(initializer) && initializer.expression
    ? initializer.expression
    : undefined;
}

function jsxStaticAttribute(element: ts.JsxElement, name: string): string | undefined {
  const initializer = jsxAttribute(element, name)?.initializer;
  return initializer && ts.isStringLiteral(initializer) ? initializer.text : undefined;
}

function isButton(node: ts.Node): node is ts.JsxElement {
  return (
    ts.isJsxElement(node)
    && ts.isIdentifier(node.openingElement.tagName)
    && node.openingElement.tagName.text === 'button'
  );
}

function isStringValue(expression: ts.Expression, value: string): boolean {
  const current = unwrapExpression(expression);
  return (
    (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current))
    && current.text === value
  );
}

function isApprovalLabel(expression: ts.Expression): boolean {
  const current = unwrapExpression(expression);
  return (
    ts.isConditionalExpression(current)
    && isIdentifier(current.condition, 'approvalMode')
    && isStringValue(current.whenTrue, '关闭人工审批')
    && isStringValue(current.whenFalse, '开启人工审批')
  );
}

function callsApprovalToggle(expression: ts.Expression): boolean {
  const current = unwrapExpression(expression);
  if (!ts.isArrowFunction(current)) return false;
  const body = current.body;
  const calls = ts.isBlock(body)
    ? body.statements
      .filter(ts.isExpressionStatement)
      .map((statement) => unwrapExpression(statement.expression))
      .filter(ts.isCallExpression)
    : ts.isCallExpression(unwrapExpression(body))
      ? [unwrapExpression(body) as ts.CallExpression]
      : [];
  return calls.some((call) => {
    if (!isIdentifier(call.expression, 'onReviewModeChange')) return false;
    const argument = call.arguments[0];
    if (!argument) return false;
    const toggledMode = unwrapExpression(argument);
    return (
      ts.isPrefixUnaryExpression(toggledMode)
      && toggledMode.operator === ts.SyntaxKind.ExclamationToken
      && isIdentifier(toggledMode.operand, 'approvalMode')
    );
  });
}

test('the compact composer exposes review mode as one pressed tool button', () => {
  const sourceFile = chatWindowAst();
  const approvalButtons = findNodes(sourceFile, isButton).filter((button) => {
    const label = jsxAttributeExpression(button, 'aria-label');
    return Boolean(label && isApprovalLabel(label));
  });
  assert.equal(approvalButtons.length, 1);
  const approvalButton = approvalButtons[0];
  assert.ok(approvalButton);

  const pressed = jsxAttributeExpression(approvalButton, 'aria-pressed');
  const disabled = jsxAttributeExpression(approvalButton, 'disabled');
  const onClick = jsxAttributeExpression(approvalButton, 'onClick');
  assert.ok(pressed && isIdentifier(pressed, 'approvalMode'));
  assert.ok(disabled && isIdentifier(disabled, 'streaming'));
  assert.ok(onClick && callsApprovalToggle(onClick));
  assert.equal(jsxStaticAttribute(approvalButton, 'type'), 'button');
});

test('App keeps automatic review mode as the default', async () => {
  const app = await source('../src/App.tsx');

  assert.match(app, /const \[reviewMode, setReviewMode\] = useState\(false\)/);
  assert.match(app, /reviewMode/);
});

test('chat streaming accepts an explicit review mode and routes approval events', async () => {
  const chat = await source('../src/lib/chat.ts');

  assert.match(chat, /review = false/);
  assert.match(chat, /onApproval\?/);
  assert.match(chat, /review\s*\?\s*\{ review: true \}/);
  assert.match(chat, /event\.type === 'approval'/);
});

test('streamChat sends the review flag only when requested', async () => {
  const { streamChat } = await import('../src/lib/chat.js');
  const originalFetch = globalThis.fetch;
  let requestBody = '';
  globalThis.fetch = async (_url, init) => {
    requestBody = String(init?.body ?? '');
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n'));
        controller.close();
      }
    });
    return new Response(body, { status: 200 });
  };
  try {
    await streamChat([{ role: 'user', content: '审批' }], new AbortController().signal, {}, undefined, 'text', true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal((JSON.parse(requestBody) as { review?: boolean }).review, true);
});

test('messages render approval actions and call the approval decision endpoint', async () => {
  const item = await source('../src/components/MessageItem.tsx');

  assert.match(item, /message\.approval/);
  assert.match(item, /api\/approvals/);
  assert.match(item, /批准/);
  assert.match(item, /拒绝/);
});
