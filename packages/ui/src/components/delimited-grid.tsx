import {
  CellStyleModule,
  ClientSideRowModelModule,
  RowAutoHeightModule,
  themeQuartz
} from 'ag-grid-community';
import type { ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useMemo } from 'react';

import './delimited-grid.css';

type GridRow = { number: number; cells: readonly string[] };

const modules = [CellStyleModule, ClientSideRowModelModule, RowAutoHeightModule];

const theme = themeQuartz.withParams({
  backgroundColor: 'var(--card)',
  foregroundColor: 'var(--card-foreground)',
  borderColor: 'var(--border)',
  headerBackgroundColor: 'var(--muted)',
  headerTextColor: 'var(--muted-foreground)',
  accentColor: 'var(--ring)',
  rowHoverColor: 'var(--muted)',
  fontFamily: 'inherit',
  fontSize: 14,
  headerHeight: 34,
  rowHeight: 36,
  wrapperBorderRadius: 'var(--control-radius)'
});

const defaultColDef: ColDef<GridRow> = {
  editable: false,
  sortable: false,
  filter: false,
  suppressHeaderMenuButton: true,
  suppressMovable: true,
  cellDataType: false
};

function columnAddress(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26));

  return index < 26 ? letter : columnAddress(Math.floor(index / 26) - 1) + letter;
}

export default function DelimitedGrid({
  columns,
  rows,
  rowLabel
}: {
  columns: number;
  rows: readonly (readonly string[])[];
  rowLabel: string;
}) {
  const rowData = useMemo(() => rows.map((cells, index) => ({ number: index + 1, cells })), [rows]);
  const columnDefs = useMemo<ColDef<GridRow>[]>(
    () => [
      {
        field: 'number',
        headerName: rowLabel,
        width: 64,
        pinned: 'left',
        resizable: false,
        cellClass: 'delimited-grid-row-number'
      },
      ...Array.from({ length: columns }, (_, index): ColDef<GridRow> => ({
        colId: columnAddress(index),
        headerName: columnAddress(index),
        valueGetter: ({ data }) => data?.cells[index] ?? '',
        minWidth: 112,
        flex: 1,
        autoHeight: true,
        cellClass: 'delimited-grid-value'
      }))
    ],
    [columns, rowLabel]
  );

  return (
    <div className="delimited-grid">
      <AgGridReact
        theme={theme}
        modules={modules}
        rowData={rowData}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        domLayout="autoHeight"
        enableCellTextSelection
        ensureDomOrder
        suppressColumnVirtualisation
      />
    </div>
  );
}
