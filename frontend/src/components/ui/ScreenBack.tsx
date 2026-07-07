interface Props {
  onBack: () => void;
  disabled?: boolean;
}

export function ScreenBack({ onBack, disabled }: Props) {
  return (
    <button className="ghostButton" onClick={onBack} disabled={disabled}>
      Назад
    </button>
  );
}
