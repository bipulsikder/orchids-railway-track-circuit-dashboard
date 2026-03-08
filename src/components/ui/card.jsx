export function Card({ className = '', children }) {
  return (
    <div
      className={`rounded-lg border border-[#30363d] bg-[#161b22] shadow-[0_0_0_1px_rgba(255,255,255,0.02)] ${className}`}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className = '', children }) {
  return <div className={`px-4 pt-4 ${className}`}>{children}</div>
}

export function CardTitle({ className = '', children }) {
  return <h3 className={`text-sm font-semibold tracking-wide text-[#c9d1d9] ${className}`}>{children}</h3>
}

export function CardContent({ className = '', children }) {
  return <div className={`p-4 ${className}`}>{children}</div>
}
