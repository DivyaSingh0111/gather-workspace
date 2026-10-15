export default function TableEditor({ value, onChange }) {
  const { columns, rows } = value;

  function setCell(rowIndex, columnIndex, text) {
    const nextRows = rows.map((row, r) =>
      r === rowIndex ? row.map((cell, c) => (c === columnIndex ? text : cell)) : row
    );
    onChange({ columns, rows: nextRows });
  }

  function setHeader(columnIndex, text) {
    onChange({
      columns: columns.map((name, c) => (c === columnIndex ? text : name)),
      rows,
    });
  }

  function addRow() {
    onChange({ columns, rows: [...rows, columns.map(() => "")] });
  }

  function addColumn() {
    onChange({
      columns: [...columns, `Column ${columns.length + 1}`],
      rows: rows.map((row) => [...row, ""]),
    });
  }

  function deleteRow(rowIndex) {
    if (rows.length <= 1) return;
    onChange({ columns, rows: rows.filter((_, r) => r !== rowIndex) });
  }

  function deleteColumn(columnIndex) {
    if (columns.length <= 1) return;
    onChange({
      columns: columns.filter((_, c) => c !== columnIndex),
      rows: rows.map((row) => row.filter((_, c) => c !== columnIndex)),
    });
  }

  return (
    <div className="sheet">
      <div className="sheet-scroll">
        <table className="sheet-table">
          <thead>
            <tr>
              {columns.map((name, c) => (
                <th key={c}>
                  <div className="sheet-head-cell">
                    <input
                      value={name}
                      onChange={(event) => setHeader(c, event.target.value)}
                      aria-label={`Column ${c + 1} name`}
                    />
                    {columns.length > 1 && (
                      <button
                        className="sheet-x"
                        onClick={() => deleteColumn(c)}
                        title="Delete column"
                        aria-label={`Delete column ${c + 1}`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th className="sheet-corner" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {columns.map((_, c) => (
                  <td key={c}>
                    <input
                      value={row[c] ?? ""}
                      onChange={(event) => setCell(r, c, event.target.value)}
                      aria-label={`Row ${r + 1}, ${columns[c]}`}
                    />
                  </td>
                ))}
                <td className="sheet-corner">
                  {rows.length > 1 && (
                    <button
                      className="sheet-x"
                      onClick={() => deleteRow(r)}
                      title="Delete row"
                      aria-label={`Delete row ${r + 1}`}
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sheet-actions">
        <button className="ghost-button small" onClick={addRow}>
          + Add row
        </button>
        <button className="ghost-button small" onClick={addColumn}>
          + Add column
        </button>
      </div>
    </div>
  );
}