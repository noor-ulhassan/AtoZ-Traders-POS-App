import { useCallback, useState } from 'react'
import { ApiError, errorMessage, fieldErrors } from '../lib/api'
import { useToast } from '../components/ui/Toast'

interface Options<T> {
  /** Toast title on success. Omit for saves that speak for themselves. */
  successMessage?: string
  onSuccess?: (result: T) => void
  /** Heading for the error toast. Defaults to "Could not save". */
  errorTitle?: string
}

interface Mutation<Args extends unknown[], T> {
  run: (...args: Args) => Promise<T | undefined>
  isPending: boolean
  /** Field-level messages from the last rejected attempt. */
  errors: Record<string, string>
  reset: () => void
}

/**
 * Runs a write and handles the three things every write needs: a pending flag
 * so the button cannot be double-clicked, a toast when it fails, and the
 * field-level messages the form shows inline.
 *
 * A cancelled native dialog (the owner closing a file picker) resolves quietly
 * — that is not an error worth a red toast.
 */
export function useMutation<Args extends unknown[], T>(
  action: (...args: Args) => Promise<T>,
  options: Options<T> = {}
): Mutation<Args, T> {
  const toast = useToast()
  const [isPending, setIsPending] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const run = useCallback(
    async (...args: Args): Promise<T | undefined> => {
      setIsPending(true)
      setErrors({})
      try {
        const result = await action(...args)
        if (options.successMessage) toast.success(options.successMessage)
        options.onSuccess?.(result)
        return result
      } catch (error) {
        if (error instanceof ApiError && error.isCancelled) return undefined
        setErrors(fieldErrors(error))
        toast.error(options.errorTitle ?? 'Could not save', errorMessage(error))
        return undefined
      } finally {
        setIsPending(false)
      }
    },
    // The options object is recreated by the caller on every render; reading
    // it through the closure keeps this callback stable enough in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action, toast]
  )

  return { run, isPending, errors, reset: () => setErrors({}) }
}
