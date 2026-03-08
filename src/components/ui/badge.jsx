export function Badge({ className = '', children }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border border-[#30363d] bg-[#21262d] px-2 py-0.5 text-xs font-medium text-[#8b949e] ${className}`}
    >
      {children}
    </span>
  )
}
