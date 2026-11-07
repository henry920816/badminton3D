import { useEffect, useState } from 'react'


/**
 * 量 ref 指到的元素的內容大小（ResizeObserver），回傳 { width, height }。
 * 只在掛載時接上一次：元素要在第一次 render 就存在。
 */
export function usePanelSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [ref])

  return size
}
