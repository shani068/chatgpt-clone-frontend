// Generic GET hook — wraps useQuery with abort-signal support and a manual invalidate helper
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { resolveError } from "@/utils/resolve-error";

import type { AxiosRequestConfig } from "axios";

interface UseFetchOptions<T> {
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
  refetchInterval?: number | false;
  initialData?: T;
  params?: Record<string, string | number | boolean>;
  config?: AxiosRequestConfig;
}

export function useFetch<T = unknown>(
  url: string | null,
  queryKey: unknown[],
  options: UseFetchOptions<T> = {}
) {
  const queryClient = useQueryClient();

  const {
    enabled: isEnabled = true,
    staleTime = 60 * 1000,
    gcTime = 5 * 60 * 1000,
    refetchInterval = false,
    initialData,
    params,
    config,
  } = options;

  const query = useQuery<T, Error>({
    queryKey,
    queryFn: async ({ signal }) => {
      const res = await api.get<T>(url ?? "", { ...config, params, signal });
      return res.data;
    },
    enabled: !!url && isEnabled,
    staleTime,
    gcTime,
    refetchInterval,
    initialData,
  });

  // Resolves once the refetch finishes, so callers can await fresh data.
  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  return {
    ...query,
    error: query.isError ? resolveError(query.error) : null,
    invalidate,
  };
}
