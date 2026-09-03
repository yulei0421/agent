import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as ts from 'typescript/unstable/ast';
import {
  balancedBlock,
  closeSourceAst,
  findNodes,
  hasStaticClassToken,
  isIdentifier,
  isJsxElementNamed,
  jsxAttributeExpression,
  jsxStaticAttribute,
  sourceFile,
  topLevelLogicalOrOperands,
  unwrapExpression
} from './sourceAst.js';

async function readSource(path: string) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

function chatWindowAst(): ts.SourceFile {
  return sourceFile('src/components/ChatWindow.tsx');
}

test.after(closeSourceAst);

function cssRuleBody(source: string, selector: RegExp): string {
  const flags = selector.flags.replace(/[gy]/g, '');
  return new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`, flags).exec(source)?.[1] ?? '';
}

function jsxButtonBranch(expression: ts.Expression): ts.JsxElement | undefined {
  const current = unwrapExpression(expression);
  return isJsxElementNamed(current, 'button') ? current : undefined;
}

function isNumericValue(expression: ts.Expression, value: number): boolean {
  const current = unwrapExpression(expression);
  return ts.isNumericLiteral(current) && Number(current.text) === value;
}

function isStringValue(expression: ts.Expression, value: string): boolean {
  const current = unwrapExpression(expression);
  return (
    (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current))
    && current.text === value
  );
}

function isProperty(expression: ts.Expression, owner: string, property: string): boolean {
  const current = unwrapExpression(expression);
  return (
    ts.isPropertyAccessExpression(current)
    && current.name.text === property
    && isIdentifier(current.expression, owner)
  );
}

function topLevelAssignment(statement: ts.Statement): ts.BinaryExpression | undefined {
  if (!ts.isExpressionStatement(statement)) return undefined;
  const expression = unwrapExpression(statement.expression);
  return (
    ts.isBinaryExpression(expression)
    && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
  )
    ? expression
    : undefined;
}

function isStyleProperty(expression: ts.Expression, owner: string, property: string): boolean {
  const current = unwrapExpression(expression);
  return (
    ts.isPropertyAccessExpression(current)
    && current.name.text === property
    && ts.isPropertyAccessExpression(current.expression)
    && current.expression.name.text === 'style'
    && isIdentifier(current.expression.expression, owner)
  );
}

function isHeightCalculation(expression: ts.Expression, textareaName: string): boolean {
  const current = unwrapExpression(expression);
  if (!ts.isTemplateExpression(current)) return false;
  return current.templateSpans.some((span) => {
    const calculation = unwrapExpression(span.expression);
    if (!ts.isCallExpression(calculation)) return false;
    const callee = unwrapExpression(calculation.expression);
    const scrollHeight = calculation.arguments[0];
    const maximum = calculation.arguments[1];
    return (
      ts.isPropertyAccessExpression(callee)
      && isIdentifier(callee.expression, 'Math')
      && callee.name.text === 'min'
      && Boolean(scrollHeight && isProperty(scrollHeight, textareaName, 'scrollHeight'))
      && Boolean(maximum && isNumericValue(maximum, 200))
      && span.literal.text.includes('px')
    );
  });
}

function isOverflowCalculation(expression: ts.Expression, textareaName: string): boolean {
  const current = unwrapExpression(expression);
  if (!ts.isConditionalExpression(current)) return false;
  const condition = unwrapExpression(current.condition);
  return (
    ts.isBinaryExpression(condition)
    && condition.operatorToken.kind === ts.SyntaxKind.GreaterThanToken
    && isProperty(condition.left, textareaName, 'scrollHeight')
    && isNumericValue(condition.right, 200)
    && isStringValue(current.whenTrue, 'auto')
    && isStringValue(current.whenFalse, 'hidden')
  );
}

function isNegatedContentTrim(expression: ts.Expression): boolean {
  const current = unwrapExpression(expression);
  if (!ts.isPrefixUnaryExpression(current) || current.operator !== ts.SyntaxKind.ExclamationToken) return false;
  const operand = unwrapExpression(current.operand);
  if (!ts.isCallExpression(operand) || operand.arguments.length !== 0) return false;
  const callee = unwrapExpression(operand.expression);
  return (
    ts.isPropertyAccessExpression(callee)
    && callee.name.text === 'trim'
    && isIdentifier(callee.expression, 'content')
  );
}

test('ChatWindow forwards streaming state to MessageList', async () => {
  const source = await readSource('../src/components/ChatWindow.tsx');

  assert.match(source, /<MessageList\b[^>]*\bstreaming=\{streaming\}/);
});

test('MessageList forwards streaming state to MessageItem', async () => {
  const source = await readSource('../src/components/MessageList.tsx');

  assert.match(source, /<MessageItem\b[^>]*\bstreaming=\{streaming\}/);
});

test('MessageItem detects streaming messages by status', async () => {
  const source = await readSource('../src/components/MessageItem.tsx');

  assert.match(source, /message\.status\s*===\s*['\"]streaming['\"]/);
});

test('stylesheet provides the streaming visual contract and reduced-motion fallback', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /--text-body:\s*13px/);
  assert.match(source, /--radius-shell:\s*18px/);
  assert.match(source, /\.message\.assistant\.streaming/);
  assert.match(source, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('stylesheet provides the paper-terminal visual contract', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /--accent:\s*#0f766e/);
  assert.match(source, /--canvas:\s*#f4f1e8/);
  assert.match(source, /background:\s*radial-gradient\(circle at 14% 0%, rgba\(15, 118, 110, 0\.12\), transparent 28rem\)/);
  assert.doesNotMatch(source, /#7056f5|#18c8e8|glass-blur/);
  assert.match(source, /\.app-shell[\s\S]*border-radius:\s*var\(--radius-panel\)/);
  assert.match(source, /button:hover:not\(:disabled\)[\s\S]*translateY\(-1px\)/);
  assert.match(source, /button:active:not\(:disabled\)[\s\S]*scale\(0\.98\)/);
  assert.match(source, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('composer keeps placeholder text clear of its focused container ring', async () => {
  const source = await readSource('../src/styles.css');
  const textareaInteractionRule = cssRuleBody(
    source,
    /\.composer textarea,\s*\.composer textarea:hover,\s*\.composer textarea:focus/
  );

  assert.match(textareaInteractionRule, /box-shadow:\s*none/);
  assert.match(textareaInteractionRule, /outline:\s*0/);
});

test('composer uses compact textarea spacing', async () => {
  const source = await readSource('../src/styles.css');
  const textareaInteractionRule = cssRuleBody(
    source,
    /\.composer textarea,\s*\.composer textarea:hover,\s*\.composer textarea:focus/
  );

  assert.match(textareaInteractionRule, /padding:\s*8px 10px/);
});

test('assistant messages have top breathing room and a flat tool-source attachment', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /\.message-list\s*\{[\s\S]*padding:\s*20px 0 28px/);
  assert.match(source, /\.message\s+\.tool-events\s*\{[\s\S]*border:\s*0[\s\S]*background:\s*transparent[\s\S]*box-shadow:\s*none/);
  assert.match(source, /\.message\s+\.tool-events:hover\s*\{[\s\S]*transform:\s*none/);
});

test('ChatWindow renders exactly one compact toolbar without legacy composer sections', async () => {
  const source = await readSource('../src/components/ChatWindow.tsx');
  const sourceFile = chatWindowAst();
  const toolbars = findNodes(sourceFile, (node): node is ts.JsxElement => (
    ts.isJsxElement(node) && hasStaticClassToken(node, 'composer-toolbar')
  ));

  assert.equal(toolbars.length, 1);
  assert.doesNotMatch(source, /className="web-search-control"/);
  assert.doesNotMatch(source, /className="composer-context-note"/);
  assert.doesNotMatch(source, /className="composer-actions"/);
});

test('composer toolbar switches between stop and send button branches while streaming', async () => {
  const sourceFile = chatWindowAst();
  const toolbars = findNodes(sourceFile, (node): node is ts.JsxElement => (
    ts.isJsxElement(node) && hasStaticClassToken(node, 'composer-toolbar')
  ));
  assert.equal(toolbars.length, 1);
  const toolbar = toolbars[0];
  assert.ok(toolbar);

  const streamingConditions = findNodes(toolbar, ts.isConditionalExpression).filter(
    (conditional) => isIdentifier(conditional.condition, 'streaming')
  );
  assert.equal(streamingConditions.length, 1);
  const streamingCondition = streamingConditions[0];
  assert.ok(streamingCondition);

  const stopButton = jsxButtonBranch(streamingCondition.whenTrue);
  const sendButton = jsxButtonBranch(streamingCondition.whenFalse);
  assert.ok(stopButton);
  assert.ok(sendButton);

  assert.equal(jsxStaticAttribute(stopButton, 'aria-label'), '停止生成');
  assert.equal(jsxStaticAttribute(stopButton, 'type'), 'button');
  const stopClick = jsxAttributeExpression(stopButton, 'onClick');
  assert.ok(stopClick && isIdentifier(stopClick, 'onStop'));

  assert.equal(jsxStaticAttribute(sendButton, 'aria-label'), '发送消息');
  assert.equal(jsxStaticAttribute(sendButton, 'type'), 'submit');
  const sendDisabled = jsxAttributeExpression(sendButton, 'disabled');
  assert.ok(sendDisabled);
  const disabledOperands = topLevelLogicalOrOperands(sendDisabled);
  assert.ok(disabledOperands);
  const [left, right] = disabledOperands;
  assert.ok(
    (isIdentifier(left, 'attachmentLoading') && isNegatedContentTrim(right))
    || (isNegatedContentTrim(left) && isIdentifier(right, 'attachmentLoading'))
  );
});

test('ChatWindow textarea keeps compact rows and keyboard submission behavior', async () => {
  const source = await readSource('../src/components/ChatWindow.tsx');
  const textarea = source.match(/<textarea\b[\s\S]*?\/>/)?.[0] ?? '';

  assert.match(textarea, /ref=\{textareaRef\}/);
  assert.match(textarea, /rows=\{1\}/);
  assert.match(textarea, /onKeyDown=\{\(event\)\s*=>\s*\{\s*if\s*\(\s*event\.key\s*!==\s*['\"]Enter['\"]\s*\|\|\s*event\.shiftKey\s*\|\|\s*event\.nativeEvent\.isComposing\s*\)\s*return;\s*event\.preventDefault\(\);\s*event\.currentTarget\.form\?\.requestSubmit\(\);\s*\}\}/);
});

test('ChatWindow auto-sizes the textarea inside the content effect', async () => {
  const sourceFile = chatWindowAst();
  const contentEffects = findNodes(sourceFile, ts.isCallExpression).filter((call) => {
    if (!isIdentifier(call.expression, 'useEffect')) return false;
    const dependencies = call.arguments[1];
    if (!dependencies || !ts.isArrayLiteralExpression(dependencies)) return false;
    return dependencies.elements.some((element) => isIdentifier(element, 'content'));
  });
  assert.equal(contentEffects.length, 1);
  const contentEffect = contentEffects[0];
  assert.ok(contentEffect);
  const callback = contentEffect.arguments[0];
  assert.ok(callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)));
  assert.ok(ts.isBlock(callback.body));
  const statements = [...callback.body.statements];

  let textareaName: string | undefined;
  let declarationIndex = -1;
  for (const [index, statement] of statements.entries()) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (
        ts.isIdentifier(declaration.name)
        && initializer
        && ts.isPropertyAccessExpression(unwrapExpression(initializer))
        && isProperty(initializer, 'textareaRef', 'current')
      ) {
        textareaName = declaration.name.text;
        declarationIndex = index;
      }
    }
  }
  assert.ok(textareaName);

  const guardIndex = statements.findIndex((statement, index) => {
    if (index <= declarationIndex || !ts.isIfStatement(statement)) return false;
    const condition = unwrapExpression(statement.expression);
    const guardedStatement = ts.isBlock(statement.thenStatement)
      ? statement.thenStatement.statements[0]
      : statement.thenStatement;
    const returns = ts.isReturnStatement(statement.thenStatement)
      || (
        ts.isBlock(statement.thenStatement)
        && statement.thenStatement.statements.length === 1
        && Boolean(guardedStatement && ts.isReturnStatement(guardedStatement))
      );
    return (
      returns
      && ts.isPrefixUnaryExpression(condition)
      && condition.operator === ts.SyntaxKind.ExclamationToken
      && isIdentifier(condition.operand, textareaName)
    );
  });

  const resetIndex = statements.findIndex((statement, index) => {
    if (index <= guardIndex) return false;
    const assignment = topLevelAssignment(statement);
    return Boolean(
      assignment
      && isStyleProperty(assignment.left, textareaName, 'height')
      && isStringValue(assignment.right, '0px')
    );
  });

  const heightIndex = statements.findIndex((statement, index) => {
    if (index <= resetIndex) return false;
    const assignment = topLevelAssignment(statement);
    return Boolean(
      assignment
      && isStyleProperty(assignment.left, textareaName, 'height')
      && isHeightCalculation(assignment.right, textareaName)
    );
  });

  const overflowIndex = statements.findIndex((statement, index) => {
    if (index <= heightIndex) return false;
    const assignment = topLevelAssignment(statement);
    return Boolean(
      assignment
      && isStyleProperty(assignment.left, textareaName, 'overflowY')
      && isOverflowCalculation(assignment.right, textareaName)
    );
  });

  assert.ok(declarationIndex >= 0);
  assert.ok(guardIndex > declarationIndex);
  assert.ok(resetIndex > guardIndex);
  assert.ok(heightIndex > resetIndex);
  assert.ok(overflowIndex > heightIndex);
  assert.equal(
    statements.slice(declarationIndex + 1, overflowIndex).some((statement) => ts.isReturnStatement(statement)),
    false
  );
});

test('MessageList renders variable-height messages directly and provides a new-session empty state', async () => {
  const source = await readSource('../src/components/MessageList.tsx');

  assert.doesNotMatch(source, /getVirtualRange|virtualList/);
  assert.match(source, /messages\.length === 0/);
  assert.match(source, /className="chat-empty-state"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /messages\.map\(\(message\) =>/);
});

test('stylesheet keeps the composer visible while the message list scrolls independently', async () => {
  const source = await readSource('../src/styles.css');
  const workspaceRule = cssRuleBody(source, /\.workspace/);
  const chatRule = cssRuleBody(source, /\.chat/);
  const messageListRule = cssRuleBody(source, /\.message-list/);

  assert.match(workspaceRule, /min-height:\s*0/);
  assert.match(chatRule, /grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.match(chatRule, /overflow:\s*hidden/);
  assert.match(messageListRule, /min-height:\s*0/);
  assert.match(messageListRule, /overflow:\s*auto/);
});

test('stylesheet bounds the compact textarea and toolbar controls', async () => {
  const source = await readSource('../src/styles.css');
  const textareaRule = cssRuleBody(source, /\.composer textarea/);
  const toolbarRule = cssRuleBody(source, /\.composer-toolbar/);

  assert.match(textareaRule, /min-height:\s*40px/);
  assert.match(textareaRule, /max-height:\s*200px/);
  assert.match(textareaRule, /resize:\s*none/);
  assert.match(toolbarRule, /min-height:\s*44px/);
});

test('stylesheet differentiates user and assistant message roles', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /\.message\.user\s*\{[\s\S]*justify-self:\s*end[\s\S]*max-width:\s*min\(88%, 640px\)/);
  assert.match(source, /\.message\.assistant\s*\{[\s\S]*max-width:\s*min\(92%, 720px\)/);
});

test('420px media rules preserve the compact toolbar without legacy actions', async () => {
  const source = await readSource('../src/styles.css');
  const narrowSection = balancedBlock(source, '@media (max-width: 420px)');

  assert.match(narrowSection, /\.composer-toolbar/);
  assert.doesNotMatch(narrowSection, /\.composer-actions/);
});

test('mobile layout condenses the sidebar so chat keeps the primary vertical space', async () => {
  const source = await readSource('../src/styles.css');

  assert.match(source, /@media \(max-width: 800px\)[\s\S]*\.app-shell\s*\{[\s\S]*grid-template-rows:\s*176px minmax\(0, 1fr\)/);
  assert.match(source, /@media \(max-width: 800px\)[\s\S]*\.sidebar\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(source, /@media \(max-width: 800px\)[\s\S]*\.session-list\s*\{[\s\S]*max-height:\s*48px[\s\S]*overflow-x:\s*auto/);
  assert.match(source, /@media \(max-width: 800px\)[\s\S]*\.sidebar-footer\s*\{[\s\S]*display:\s*none/);
});
