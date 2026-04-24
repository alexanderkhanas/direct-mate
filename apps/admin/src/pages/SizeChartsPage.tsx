import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Upload,
  Ruler,
  Trash2,
  Plus,
  Star,
  X,
  Image as ImageIcon,
} from 'lucide-react';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingState } from '../components/ui/Spinner';
import { useT } from '../i18n';

interface SizeChart {
  id: string;
  name: string;
  imagePath: string;
  brands: string[];
  categories: string[];
  isDefault: boolean;
  createdAt: string;
}

function resolveImageUrl(imagePath: string): string {
  // When the API returns "uploads/<uuid>.png" we serve it from the same origin
  // that the admin is served from (Vite proxies /uploads → API in dev).
  if (imagePath.startsWith('http')) return imagePath;
  return `/${imagePath.replace(/^\//, '')}`;
}

function TagInput({
  label,
  values,
  suggestions,
  onChange,
}: {
  label: string;
  values: string[];
  suggestions: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const add = (val: string) => {
    const clean = val.trim();
    if (!clean) return;
    if (values.some((v) => v.toLowerCase() === clean.toLowerCase())) return;
    onChange([...values, clean]);
    setDraft('');
  };

  const remove = (val: string) => onChange(values.filter((v) => v !== val));

  const unused = suggestions.filter(
    (s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <div className="flex flex-wrap gap-1.5 min-h-[32px]">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 text-gray-700 text-xs"
          >
            {v}
            <button
              type="button"
              onClick={() => remove(v)}
              className="text-gray-400 hover:text-gray-900"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            }
          }}
          placeholder=""
          className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => add(draft)}
          disabled={!draft.trim()}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {unused.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {unused.slice(0, 10).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="px-2 py-0.5 rounded-md text-[11px] bg-gray-50 text-gray-500 hover:bg-gray-100"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChartForm({
  initialValue,
  brandSuggestions,
  categorySuggestions,
  onSubmit,
  onCancel,
  submitting,
}: {
  initialValue?: Partial<SizeChart>;
  brandSuggestions: string[];
  categorySuggestions: string[];
  onSubmit: (data: {
    name: string;
    imagePath: string;
    brands: string[];
    categories: string[];
    isDefault: boolean;
  }) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const { t } = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(initialValue?.name ?? '');
  const [imagePath, setImagePath] = useState(initialValue?.imagePath ?? '');
  const [brands, setBrands] = useState<string[]>(initialValue?.brands ?? []);
  const [categories, setCategories] = useState<string[]>(
    initialValue?.categories ?? [],
  );
  const [isDefault, setIsDefault] = useState(initialValue?.isDefault ?? false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post('/size-charts/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImagePath(res.data.imagePath);
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const canSubmit = name.trim() && imagePath && !uploading && !submitting;

  return (
    <div className="space-y-4">
      {/* Image upload */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">
          {t('size_charts.image')}
        </label>
        {imagePath ? (
          <div className="flex items-start gap-3">
            <img
              src={resolveImageUrl(imagePath)}
              alt="chart"
              className="h-32 w-32 object-cover border border-gray-200 rounded-lg"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              {t('size_charts.replace')}
            </Button>
          </div>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-gray-300 transition-colors"
          >
            <Upload className="h-7 w-7 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">{t('size_charts.drop_image')}</p>
            <p className="text-xs text-gray-400 mt-1">PNG, JPG, WEBP, &lt; 10MB</p>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = '';
          }}
        />
        {uploading && (
          <p className="text-xs text-gray-400">{t('size_charts.uploading')}</p>
        )}
        {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
      </div>

      {/* Name */}
      <Input
        label={t('size_charts.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('size_charts.name_placeholder')}
      />

      {/* Brands */}
      <TagInput
        label={t('size_charts.brands')}
        values={brands}
        suggestions={brandSuggestions}
        onChange={setBrands}
      />

      {/* Categories */}
      <TagInput
        label={t('size_charts.categories')}
        values={categories}
        suggestions={categorySuggestions}
        onChange={setCategories}
      />

      {/* Default toggle */}
      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          className="h-4 w-4"
        />
        {t('size_charts.is_default')}
        <span className="text-xs text-gray-400">
          ({t('size_charts.is_default_hint')})
        </span>
      </label>

      <div className="flex gap-2 pt-2">
        <Button
          onClick={() =>
            canSubmit &&
            onSubmit({
              name: name.trim(),
              imagePath,
              brands,
              categories,
              isDefault,
            })
          }
          disabled={!canSubmit}
          loading={submitting}
        >
          {t('common.save')}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}

export default function SizeChartsPage() {
  const { t } = useT();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const { data: charts, isLoading } = useQuery<SizeChart[]>({
    queryKey: ['size-charts'],
    queryFn: () => api.get('/size-charts').then((r) => r.data),
  });

  const { data: brandSuggestions = [] } = useQuery<string[]>({
    queryKey: ['size-charts', 'brands'],
    queryFn: () => api.get('/size-charts/brands').then((r) => r.data),
  });

  const { data: categorySuggestions = [] } = useQuery<string[]>({
    queryKey: ['size-charts', 'categories'],
    queryFn: () => api.get('/size-charts/categories').then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: (body: Omit<SizeChart, 'id' | 'createdAt'>) =>
      api.post('/size-charts', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['size-charts'] });
      setEditing(null);
    },
  });

  const update = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Partial<Omit<SizeChart, 'id' | 'createdAt'>>;
    }) => api.patch(`/size-charts/${id}`, body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['size-charts'] });
      setEditing(null);
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/size-charts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['size-charts'] }),
  });

  const editingChart =
    editing && editing !== 'new'
      ? (charts ?? []).find((c) => c.id === editing)
      : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <Ruler className="h-6 w-6" />
            {t('size_charts.title')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{t('size_charts.subtitle')}</p>
        </div>
        {editing === null && (
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            {t('size_charts.add')}
          </Button>
        )}
      </div>

      {editing === 'new' && (
        <Card>
          <h2 className="text-sm font-semibold text-gray-900 mb-4">
            {t('size_charts.new_chart')}
          </h2>
          <ChartForm
            brandSuggestions={brandSuggestions}
            categorySuggestions={categorySuggestions}
            submitting={create.isPending}
            onSubmit={(data) => create.mutate(data)}
            onCancel={() => setEditing(null)}
          />
        </Card>
      )}

      {editingChart && (
        <Card>
          <h2 className="text-sm font-semibold text-gray-900 mb-4">
            {t('size_charts.edit_chart')}
          </h2>
          <ChartForm
            initialValue={editingChart}
            brandSuggestions={brandSuggestions}
            categorySuggestions={categorySuggestions}
            submitting={update.isPending}
            onSubmit={(data) => update.mutate({ id: editingChart.id, body: data })}
            onCancel={() => setEditing(null)}
          />
        </Card>
      )}

      {isLoading ? (
        <LoadingState message={t('common.loading')} />
      ) : !charts || charts.length === 0 ? (
        <Card>
          <EmptyState
            icon={ImageIcon}
            title={t('size_charts.empty_title')}
            description={t('size_charts.empty_desc')}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {charts.map((chart) => (
            <Card key={chart.id}>
              <div className="flex gap-4">
                <img
                  src={resolveImageUrl(chart.imagePath)}
                  alt={chart.name}
                  className="h-24 w-24 object-cover rounded-lg border border-gray-200 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-gray-900">
                      {chart.name}
                    </h3>
                    {chart.isDefault && (
                      <Badge variant="default">
                        <Star className="h-3 w-3" /> {t('size_charts.default')}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2 space-y-1">
                    {chart.brands.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        <span className="text-xs text-gray-400">
                          {t('size_charts.brands')}:
                        </span>
                        {chart.brands.map((b) => (
                          <span
                            key={b}
                            className="text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700"
                          >
                            {b}
                          </span>
                        ))}
                      </div>
                    )}
                    {chart.categories.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        <span className="text-xs text-gray-400">
                          {t('size_charts.categories')}:
                        </span>
                        {chart.categories.map((c) => (
                          <span
                            key={c}
                            className="text-xs px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(chart.id)}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm(t('size_charts.confirm_delete'))) del.mutate(chart.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
