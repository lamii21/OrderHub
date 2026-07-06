export function SheetCreatedPanel({
  title,
  sheetId,
  description,
}: {
  title: string;
  sheetId: string;
  description?: string;
}) {
  return (
    <div className="rounded-lg border bg-white p-6 text-center">
      <h1 className="mb-2 text-xl font-semibold text-green-700">{title}</h1>
      {description ? (
        <p className="mb-4 text-sm text-gray-500">{description}</p>
      ) : (
        <>
          <p className="mb-1 text-sm text-gray-500">Spreadsheet ID</p>
          <p className="mb-4 break-all font-mono text-sm">{sheetId}</p>
        </>
      )}
      <a
        href={`https://docs.google.com/spreadsheets/d/${sheetId}/edit`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Open Sheet
      </a>
    </div>
  );
}
