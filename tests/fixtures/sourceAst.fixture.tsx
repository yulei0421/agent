export function SourceAstFixture() {
  const directStop = () => onStop();
  const nestedStop = () => () => onStop();
  const logicalAnd = attachmentLoading && !content.trim();
  const logicalOr = attachmentLoading || !content.trim();

  return (
    <>
      <div className="composer-toolbar compact">
        <button aria-label="inside-one"></button>
        <button aria-label="inside-two"></button>
      </div>
      <button aria-label="outside"></button>
    </>
  );
}
