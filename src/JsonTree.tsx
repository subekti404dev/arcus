import { useState } from 'react';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function preview(value: JsonValue) {
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (isRecord(value)) return `Object(${Object.keys(value).length})`;
  if (typeof value === 'string') return `"${value}"`;
  if (value === null) return 'null';
  return String(value);
}

function Primitive({ value }: { value: JsonValue }) {
  if (typeof value === 'string') return <span className="json-string">"{value}"</span>;
  if (typeof value === 'number') return <span className="json-number">{value}</span>;
  if (typeof value === 'boolean') return <span className="json-boolean">{String(value)}</span>;
  if (value === null) return <span className="json-null">null</span>;
  return null;
}

function JsonNode({ name, value, level = 0, defaultExpanded = true }: { name?: string; value: JsonValue; level?: number; defaultExpanded?: boolean }) {
  const expandable = Array.isArray(value) || isRecord(value);
  const [expanded, setExpanded] = useState(defaultExpanded && level < 2);

  if (!expandable) {
    return (
      <div className="json-line" style={{ paddingLeft: level * 16 }}>
        {name !== undefined && <span className="json-key">"{name}": </span>}
        <Primitive value={value} />
      </div>
    );
  }

  const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);
  const open = Array.isArray(value) ? '[' : '{';
  const close = Array.isArray(value) ? ']' : '}';

  return (
    <div>
      <button className="json-line json-toggle" style={{ paddingLeft: level * 16 }} onClick={() => setExpanded((item) => !item)}>
        <span className="json-caret">{expanded ? '▾' : '▸'}</span>
        {name !== undefined && <span className="json-key">"{name}": </span>}
        <span className="json-bracket">{open}</span>
        {!expanded && <span className="json-preview"> {preview(value)} </span>}
        {!expanded && <span className="json-bracket">{close}</span>}
      </button>
      {expanded && (
        <>
          {entries.map(([key, child]) => (
            <JsonNode key={key} name={Array.isArray(value) ? undefined : key} value={child} level={level + 1} defaultExpanded={defaultExpanded} />
          ))}
          <div className="json-line" style={{ paddingLeft: level * 16 }}>
            <span className="json-spacer" />
            <span className="json-bracket">{close}</span>
          </div>
        </>
      )}
    </div>
  );
}

export function JsonTree({ data }: { data: JsonValue }) {
  const [expandAllKey, setExpandAllKey] = useState(0);
  const [defaultExpanded, setDefaultExpanded] = useState(true);

  return (
    <div className="json-tree">
      <div className="json-toolbar">
        <button onClick={() => { setDefaultExpanded(true); setExpandAllKey((key) => key + 1); }}>Expand all</button>
        <button onClick={() => { setDefaultExpanded(false); setExpandAllKey((key) => key + 1); }}>Collapse all</button>
      </div>
      <div key={expandAllKey} className="json-viewer">
        <JsonNode value={data} defaultExpanded={defaultExpanded} />
      </div>
    </div>
  );
}

export type { JsonValue };
