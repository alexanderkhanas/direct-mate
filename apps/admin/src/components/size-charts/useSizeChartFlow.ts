import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useT } from '../../i18n';
import {
  SIZE_CHARTS_KEY,
  STORE_CONFIG_KEY,
  chartScope,
  errorReason,
  isWholeStore,
  useMatchCount,
  useScopeOptions,
  useSizeCharts,
  type ChartScope,
  type SizeChart,
} from './api';
import { fromEditTable, toEditTable, type EditTable } from './table-edit';

/**
 * What the size charts flow shows (design boards m30–m34, d30):
 *   loading   the charts are still loading
 *   start     the upload card, how it works, «Немає сітки» (setup)
 *   scope     which products the chart is for, with a live count
 *   reading   the vision model reads the picture (a few seconds)
 *   check     the table the model read, to correct and save
 *   list      the saved charts, what has no chart yet, the customer's view
 */
export type ChartView = 'loading' | 'start' | 'scope' | 'reading' | 'check' | 'list';

/** The chart being added or edited. */
interface Working {
  /** Null until «Прочитати сітку» creates it. */
  chartId: string | null;
  imagePath: string;
  fileName: string | null;
  scope: ChartScope;
  /** A new picture for an existing chart, not read yet. */
  imageChanged: boolean;
  /** Where «Назад» from the check screen goes: back to the scope (a new chart) or to the list. */
  from: 'new' | 'list';
}

export interface ChartAction {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}

interface StoreConfig {
  flowConfig?: { sizing?: { advice?: 'recommend' | 'consult'; askMeasurementsFirst?: boolean } } | null;
}

/** The owner-facing name of a chart, from its scope: «Lliana · Сукні, Сорочки», or «Усі товари». */
function scopeName(scope: ChartScope, all: string): string {
  if (isWholeStore(scope)) return all;
  const name = [scope.brands.join(', '), scope.categories.join(', ')].filter(Boolean).join(' · ');
  return name.length > 80 ? `${name.slice(0, 79)}…` : name;
}

/**
 * The size charts flow shared by the setup step and the Size charts page:
 * the screen, the chart being added, the table being checked, the API
 * calls, and the one primary action and «Назад» for each screen. The step
 * hands them to the setup footer; the page renders them as its own buttons.
 */
export function useSizeChartFlow({ inSetup, refresh }: { inSetup: boolean; refresh?: () => Promise<void> }) {
  const { t } = useT();
  const qc = useQueryClient();
  const chartsQuery = useSizeCharts();
  const options = useScopeOptions();
  const config = useQuery<StoreConfig>({
    queryKey: STORE_CONFIG_KEY,
    queryFn: () => api.get('/engine/config').then((r) => r.data),
  });

  const [screen, setScreen] = useState<Exclude<ChartView, 'loading'> | null>(null);
  const [working, setWorking] = useState<Working | null>(null);
  const [edit, setEdit] = useState<EditTable | null>(null);
  const [sendImage, setSendImage] = useState(true);
  /** Set by a save that found mistakes: from then on the table's problems show live. */
  const [showProblems, setShowProblems] = useState(false);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** The screen an image-only chart was read from («Прочитати» on start or on the list). */
  const readFrom = useRef<'start' | 'list' | null>(null);

  const charts = useMemo(() => chartsQuery.data ?? [], [chartsQuery.data]);
  const sizing = config.data?.flowConfig?.sizing;
  const match = useMatchCount(working?.scope ?? { brands: [], categories: [] }, !!working);

  const invalidate = () => qc.invalidateQueries({ queryKey: SIZE_CHARTS_KEY });

  const openCheck = (chart: SizeChart, from: Working['from']) => {
    if (!chart.table) return;
    setWorking({ chartId: chart.id, imagePath: chart.imagePath, fileName: null, scope: chartScope(chart, options), imageChanged: false, from });
    setEdit(toEditTable(chart.table));
    setSendImage(chart.sendImage);
    setShowProblems(false);
    save.reset();
    setScreen('check');
  };

  // Setup resumes an unchecked chart where the owner left it.
  const resumed = useRef(false);
  useEffect(() => {
    if (!inSetup || resumed.current || !chartsQuery.data || options.loading) return;
    resumed.current = true;
    const draft = chartsQuery.data.find((c) => c.status === 'draft' && c.table);
    if (draft) openCheck(draft, 'list');
  });

  const upload = useMutation<{ imagePath: string }, unknown, File>({
    mutationFn: (file) => {
      const form = new FormData();
      form.append('file', file);
      return api.post('/size-charts/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
    },
    onSuccess: ({ imagePath }, file) => {
      setReadError(null);
      setWorking((w) =>
        w && screen === 'scope'
          ? { ...w, imagePath, fileName: file.name, imageChanged: !!w.chartId }
          : { chartId: null, imagePath, fileName: file.name, scope: { brands: [], categories: [] }, imageChanged: false, from: 'new' },
      );
      setScreen('scope');
    },
  });

  /** Creates the chart (or saves its scope and new picture), then reads it. */
  const read = useMutation<SizeChart, unknown, Working>({
    mutationFn: async (w) => {
      let id = w.chartId;
      const body = { name: scopeName(w.scope, t('setup_sizes.scope_all')), brands: w.scope.brands, categories: w.scope.categories };
      if (!id) {
        const created = await api.post<SizeChart>('/size-charts', { ...body, imagePath: w.imagePath }).then((r) => r.data);
        id = created.id;
        setWorking((cur) => (cur ? { ...cur, chartId: created.id } : cur));
      } else if (w.from === 'new' || w.imageChanged) {
        await api.patch(`/size-charts/${id}`, { ...body, isDefault: false, ...(w.imageChanged && { imagePath: w.imagePath }) });
      }
      return api.post<SizeChart>(`/size-charts/${id}/read`).then((r) => r.data);
    },
    onMutate: () => {
      setReadError(null);
      setScreen('reading');
    },
    onSuccess: (chart, w) => {
      void invalidate();
      openCheck(chart, w.from);
    },
    onError: (err) => {
      void invalidate();
      setReadError(errorReason(err) ?? 'read_failed');
      // Back where the read started: an image-only chart to its list, a new picture to its scope.
      setScreen(readFrom.current ?? 'scope');
    },
  });

  /** A scope change from the check screen, on a chart already read: no need to read it again. */
  const saveScope = useMutation<unknown, unknown, Working>({
    mutationFn: (w) =>
      api.patch(`/size-charts/${w.chartId}`, {
        name: scopeName(w.scope, t('setup_sizes.scope_all')),
        brands: w.scope.brands,
        categories: w.scope.categories,
        isDefault: false,
      }),
    onSuccess: () => {
      void invalidate();
      setScreen('check');
    },
  });

  const save = useMutation<SizeChart, unknown, { id: string; table: unknown }>({
    mutationFn: ({ id, table }) => api.patch(`/size-charts/${id}`, { table, status: 'ready', sendImage }).then((r) => r.data),
    onSuccess: async (chart) => {
      // A store that chose «Немає сітки» earlier recommends again once it has a checked chart.
      if (inSetup && sizing?.advice === 'consult') {
        await api.patch('/engine/config', { flowConfig: { sizing: { ...sizing, advice: 'recommend' } } }).catch(() => undefined);
        void qc.invalidateQueries({ queryKey: STORE_CONFIG_KEY });
      }
      await invalidate();
      await refresh?.();
      setJustSaved(chart.id);
      setEdit(null);
      setWorking(null);
      setScreen('list');
    },
  });

  /** «Немає сітки»: the bot collects measurements and a manager advises the size. */
  const noChart = useMutation({
    mutationFn: () => api.patch('/engine/config', { flowConfig: { sizing: { ...sizing, advice: 'consult' } } }),
    onSuccess: async () => {
      void qc.invalidateQueries({ queryKey: STORE_CONFIG_KEY });
      await refresh?.();
    },
  });

  const remove = useMutation<unknown, unknown, string>({
    mutationFn: (id) => api.delete(`/size-charts/${id}`),
    onSuccess: () => invalidate(),
  });

  const hasListed = charts.some((c) => (inSetup ? c.status !== 'image' : true));
  const view: ChartView = screen ?? (chartsQuery.isLoading || options.loading ? 'loading' : hasListed ? 'list' : 'start');

  const pickFile = () => fileInput.current?.click();
  const tableCheck = edit ? fromEditTable(edit) : null;

  const saveTable = () => {
    if (!working?.chartId || !tableCheck) return;
    if (!tableCheck.ok) {
      setShowProblems(true);
      return;
    }
    save.mutate({ id: working.chartId, table: tableCheck.table });
  };

  let primary: ChartAction | null | undefined;
  let back: (() => void) | null = null;
  switch (view) {
    case 'loading':
      primary = null;
      break;
    case 'start':
      primary = { label: t('setup_sizes.start_primary'), onClick: pickFile, loading: upload.isPending };
      if (hasListed) back = () => setScreen('list');
      break;
    case 'scope': {
      const readAlready = !!working?.chartId && !!edit && !working.imageChanged;
      const nothingMatches = !!match.data && match.data.total > 0 && match.data.count === 0;
      primary = readAlready
        ? { label: t('setup_sizes.scope_done'), onClick: () => working && saveScope.mutate(working), loading: saveScope.isPending, disabled: nothingMatches }
        : {
            label: t('setup_sizes.scope_primary'),
            onClick: () => {
              readFrom.current = null;
              if (working) read.mutate(working);
            },
            disabled: nothingMatches || upload.isPending,
          };
      back = () => setScreen(readAlready ? 'check' : 'start');
      break;
    }
    case 'reading':
      primary = { label: t('setup_sizes.reading_primary'), onClick: () => undefined, loading: true };
      break;
    case 'check':
      primary = { label: t('setup_sizes.check_primary'), onClick: saveTable, loading: save.isPending };
      back = () => {
        if (working?.from === 'new') setScreen('scope');
        else {
          setEdit(null);
          setWorking(null);
          setScreen('list');
        }
      };
      break;
    case 'list':
      // Setup: the default «Далі». The page has its own «Додати сітку».
      primary = inSetup ? undefined : null;
      break;
  }

  return {
    view,
    inSetup,
    charts,
    options,
    sizing,
    working,
    setScope: (scope: ChartScope) => setWorking((w) => (w ? { ...w, scope } : w)),
    match: match.data ?? null,
    edit,
    setEdit,
    tableProblems: showProblems && tableCheck && !tableCheck.ok ? tableCheck : null,
    sendImage,
    setSendImage,
    justSaved: charts.find((c) => c.id === justSaved) ?? null,
    fileInput,
    pickFile,
    onFile: (file: File) => upload.mutate(file),
    uploading: upload.isPending,
    uploadFailed: upload.isError,
    readError,
    saveFailed: save.isError,
    primary,
    back,
    /** «Додати сітку» / «Додати ще сітку». */
    startNew: () => {
      setJustSaved(null);
      setReadError(null);
      upload.reset();
      setWorking(null);
      setEdit(null);
      setScreen('start');
    },
    /** A chart from the list: check or edit its table. */
    openChart: (chart: SizeChart) => {
      setJustSaved(null);
      openCheck(chart, 'list');
    },
    /** An image-only chart from the list: read it now. */
    readChart: (chart: SizeChart) => {
      setJustSaved(null);
      readFrom.current = view === 'start' ? 'start' : 'list';
      const w: Working = { chartId: chart.id, imagePath: chart.imagePath, fileName: null, scope: chartScope(chart, options), imageChanged: false, from: 'list' };
      setWorking(w);
      setEdit(null);
      read.mutate(w);
    },
    /** «Змінити» on the check screen: back to the scope, keeping the table. */
    editScope: () => setScreen('scope'),
    chooseNoChart: () => noChart.mutateAsync(),
    choosingNoChart: noChart.isPending,
    noChartFailed: noChart.isError,
    remove: (chart: SizeChart) => remove.mutate(chart.id),
    removing: remove.isPending ? remove.variables : null,
    /** Leave the add or edit flow for the list (the page's «Скасувати»). */
    cancel: () => {
      setWorking(null);
      setEdit(null);
      setReadError(null);
      setScreen(null);
    },
  };
}

export type SizeChartFlow = ReturnType<typeof useSizeChartFlow>;
