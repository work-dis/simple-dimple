interface Props {
  error: string | null;
}

export function ErrorDisplay({ error }: Props) {
  if (!error) return null;
  return <p className="error">{error}</p>;
}
