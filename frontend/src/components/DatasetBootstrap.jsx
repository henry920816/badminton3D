import React, {
  useEffect,
  useState,
} from 'react'

import { api } from '../api.js'
import { useAppStore } from '../store.js'


function getErrorMessage(error) {
  const text = (
    error instanceof Error
      ? error.message
      : String(error)
  )

  try {
    const parsed = JSON.parse(
      text,
    )

    return (
      parsed.detail
      || parsed.message
      || text
    )
  } catch {
    return text
  }
}


export default function DatasetBootstrap({
  children,
}) {
  const setMatchId = useAppStore(
    state => state.setMatchId,
  )

  const [
    reloadKey,
    setReloadKey,
  ] = useState(0)

  const [
    loading,
    setLoading,
  ] = useState(true)

  const [
    error,
    setError,
  ] = useState('')


  useEffect(
    () => {
      let cancelled = false

      const loadInitialDataset = async () => {
        setLoading(true)
        setError('')

        try {
          const result = (
            await api.listDatasets()
          )

          if (cancelled) {
            return
          }

          const datasets = (
            Array.isArray(
              result?.datasets,
            )
              ? result.datasets
              : []
          )

          const currentMatchId = (
            useAppStore
              .getState()
              .matchId
          )

          const currentExists = (
            datasets.some(
              dataset => (
                dataset.match_id
                === currentMatchId
              ),
            )
          )

          if (!currentExists) {
            const firstMatchId = (
              datasets[0]?.match_id
              ?? null
            )

            setMatchId(
              firstMatchId,
            )
          }
        } catch (loadError) {
          if (cancelled) {
            return
          }

          setMatchId(null)

          setError(
            getErrorMessage(
              loadError,
            ),
          )
        } finally {
          if (!cancelled) {
            setLoading(false)
          }
        }
      }

      loadInitialDataset()

      return () => {
        cancelled = true
      }
    },
    [
      reloadKey,
      setMatchId,
    ],
  )


  if (loading) {
    return (
      <div
        className="
          h-screen
          w-screen
          bg-zinc-950
          text-zinc-100
          flex
          items-center
          justify-center
        "
      >
        <div
          className="
            rounded-lg
            border
            border-zinc-800
            bg-zinc-900
            px-6
            py-5
            text-center
          "
        >
          <div className="font-semibold">
            正在讀取資料庫中的資料集…
          </div>

          <div
            className="
              mt-2
              text-sm
              text-zinc-400
            "
          >
            系統不再從專案本地資料夾載入資料。
          </div>
        </div>
      </div>
    )
  }


  if (error) {
    return (
      <div
        className="
          h-screen
          w-screen
          bg-zinc-950
          text-zinc-100
          flex
          items-center
          justify-center
          p-6
        "
      >
        <div
          className="
            w-full
            max-w-xl
            rounded-lg
            border
            border-red-800
            bg-zinc-900
            p-6
          "
        >
          <div
            className="
              font-semibold
              text-red-300
            "
          >
            無法讀取資料集清單
          </div>

          <div
            className="
              mt-2
              whitespace-pre-wrap
              text-sm
              text-zinc-300
            "
          >
            {error}
          </div>

          <div
            className="
              mt-2
              text-xs
              text-zinc-500
            "
          >
            請確認 Docker 後端已啟動，
            並可開啟
            http://localhost:8000/health。
          </div>

          <button
            type="button"
            onClick={() => {
              setReloadKey(
                value => value + 1,
              )
            }}
            className="
              mt-4
              rounded
              border
              border-zinc-700
              bg-zinc-800
              px-3
              py-2
              text-sm
              hover:bg-zinc-700
            "
          >
            重新連線
          </button>
        </div>
      </div>
    )
  }


  return children
}