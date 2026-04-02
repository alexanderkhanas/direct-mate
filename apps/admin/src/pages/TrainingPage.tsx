import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Upload,
  Image,
  X,
  CheckCircle2,
  XCircle,
  Sparkles,
  Clock,
  FileCheck,
  Wand2,
  Bot,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  ScreenshotImportJob,
  ExtractedFragment,
  ExtractedPhrase,
  ExtractedVoiceSignal,
  TranscriptTurn,
} from '../types';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { LoadingState } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { cn } from '../lib/cn';
import { useT } from '../i18n';

type Tab = 'upload' | 'review';

/* --- Upload Tab -------------------------------------------------- */

function UploadTab() {
  const { t } = useT();
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Past jobs
  const { data: jobs, isLoading: jobsLoading } = useQuery<ScreenshotImportJob[]>({
    queryKey: ['training', 'jobs'],
    queryFn: () => api.get('/training/screenshots/jobs').then((r) => r.data),
  });

  // Poll active job
  const { data: activeJob } = useQuery<ScreenshotImportJob>({
    queryKey: ['training', 'jobs', activeJobId],
    queryFn: () => api.get(`/training/screenshots/jobs/${activeJobId}`).then((r) => r.data),
    enabled: !!activeJobId,
    refetchInterval: (query) => {
      const job = query.state.data;
      if (job && (job.status === 'completed' || job.status === 'failed')) return false;
      return 3000;
    },
  });

  // Stop polling when job finishes
  useEffect(() => {
    if (activeJob && (activeJob.status === 'completed' || activeJob.status === 'failed')) {
      qc.invalidateQueries({ queryKey: ['training', 'jobs'] });
    }
  }, [activeJob, qc]);

  const upload = useMutation({
    mutationFn: async (selectedFiles: File[]) => {
      const form = new FormData();
      selectedFiles.forEach((f) => form.append('files', f));
      const res = await api.post('/training/screenshots/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data.job as ScreenshotImportJob;
    },
    onSuccess: (job) => {
      setFiles([]);
      setActiveJobId(job.id);
      qc.invalidateQueries({ queryKey: ['training', 'jobs'] });
    },
  });

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('image/'),
    );
    setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-900 mb-4">{t('training_ext.upload_screenshots')}</h2>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors',
            dragOver
              ? 'border-gray-900 bg-gray-50'
              : 'border-gray-200 hover:border-gray-300',
          )}
        >
          <Upload className="h-8 w-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">
            {t('training_ext.drag_drop_screenshots')}
          </p>
          <p className="text-xs text-gray-400 mt-1">{t('training_ext.accepts_images')}</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const selected = Array.from(e.target.files ?? []);
              setFiles((prev) => [...prev, ...selected]);
              e.target.value = '';
            }}
          />
        </div>

        {/* Thumbnails */}
        {files.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-gray-500 mb-2">
              {t('training_ext.files_selected', { count: files.length })}
            </p>
            <div className="flex flex-wrap gap-3">
              {files.map((f, i) => (
                <div key={i} className="relative group">
                  <img
                    src={URL.createObjectURL(f)}
                    alt={f.name}
                    className="h-20 w-20 rounded-lg object-cover border border-gray-200"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(i);
                    }}
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 bg-gray-900 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <p className="text-[10px] text-gray-400 mt-1 max-w-[80px] truncate">
                    {f.name}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <Button
                size="sm"
                onClick={() => upload.mutate(files)}
                loading={upload.isPending}
                disabled={files.length === 0}
              >
                <Upload className="h-3.5 w-3.5" />
                {t('training_ext.upload_n_files', { count: files.length })}
              </Button>
              {upload.isError && (
                <p className="text-xs text-red-500 mt-2">{t('training_ext.upload_failed')}</p>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Active job progress */}
      {activeJob && activeJob.status !== 'completed' && activeJob.status !== 'failed' && (
        <Card>
          <div className="flex items-center gap-3">
            <Clock className="h-4 w-4 text-gray-400 animate-pulse" />
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">{t('training_ext.processing_screenshots')}</p>
              <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gray-900 rounded-full transition-all duration-500"
                  style={{
                    width: `${activeJob.totalFiles > 0 ? (activeJob.processedFiles / activeJob.totalFiles) * 100 : 0}%`,
                  }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {t('training_ext.files_processed', { processed: activeJob.processedFiles, total: activeJob.totalFiles })}
              </p>
            </div>
          </div>
        </Card>
      )}

      {activeJob && activeJob.status === 'completed' && (
        <Card>
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <p className="text-sm text-gray-700">
              {t('training_ext.import_completed', { count: activeJob.totalFiles })}
            </p>
          </div>
        </Card>
      )}

      {/* Past jobs */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-900 mb-4">{t('training.import_history')}</h2>
        {jobsLoading ? (
          <LoadingState message={t('training_ext.loading_jobs')} />
        ) : !jobs || jobs.length === 0 ? (
          <EmptyState
            icon={Image}
            title={t('training_ext.no_imports')}
            description={t('training_ext.upload_to_extract')}
          />
        ) : (
          <div className="divide-y divide-gray-100">
            {jobs.map((job) => (
              <div key={job.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center">
                    <FileCheck className="h-4 w-4 text-gray-400" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-700">
                      {job.totalFiles} file{job.totalFiles !== 1 && 's'}
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(job.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <Badge
                  variant={
                    job.status === 'completed'
                      ? 'success'
                      : job.status === 'failed'
                        ? 'error'
                        : 'pending'
                  }
                >
                  {job.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* --- Chat Transcript --------------------------------------------- */

function ChatTranscript({ turns }: { turns: TranscriptTurn[] }) {
  return (
    <div className="space-y-2">
      {turns.map((turn, i) => (
        <div
          key={i}
          className={cn(
            'flex',
            turn.speaker === 'customer' ? 'justify-end' : 'justify-start',
          )}
        >
          <div
            className={cn(
              'max-w-[80%] px-3 py-2 rounded-xl text-sm',
              turn.speaker === 'customer'
                ? 'bg-indigo-500 text-white rounded-br-sm'
                : 'bg-gray-100 text-gray-800 rounded-bl-sm',
            )}
          >
            <p className="text-[10px] font-medium uppercase tracking-wide mb-0.5 opacity-70">
              {turn.speaker}
            </p>
            <p>{turn.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* --- Phrase Row --------------------------------------------------- */

function PhraseRow({ phrase, onUpdate }: { phrase: ExtractedPhrase; onUpdate: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();

  const patchPhrase = useMutation({
    mutationFn: (body: { approvalStatus: string }) =>
      api.patch(`/training/screenshots/review/phrases/${phrase.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['training', 'fragments'] });
      onUpdate();
    },
  });

  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <Badge
          variant={phrase.phraseType === 'good' ? 'success' : 'error'}
          className="shrink-0"
        >
          {phrase.phraseType}
        </Badge>
        <span className="text-sm text-gray-700 truncate">{phrase.phrase}</span>
        {phrase.scenario && (
          <span className="text-xs text-gray-400 shrink-0">{phrase.scenario}</span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {phrase.approvalStatus === 'pending' ? (
          <>
            <button
              onClick={() => patchPhrase.mutate({ approvalStatus: 'approved' })}
              className="p-1 text-gray-300 hover:text-emerald-500 transition-colors"
              title={t('training.approve')}
            >
              <CheckCircle2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => patchPhrase.mutate({ approvalStatus: 'rejected' })}
              className="p-1 text-gray-300 hover:text-red-500 transition-colors"
              title={t('training.reject')}
            >
              <XCircle className="h-4 w-4" />
            </button>
          </>
        ) : (
          <Badge variant={phrase.approvalStatus === 'approved' ? 'success' : 'error'}>
            {phrase.approvalStatus}
          </Badge>
        )}
      </div>
    </div>
  );
}

/* --- Voice Signal Row -------------------------------------------- */

function VoiceSignalRow({
  signal,
  onUpdate,
}: {
  signal: ExtractedVoiceSignal;
  onUpdate: () => void;
}) {
  const { t } = useT();
  const qc = useQueryClient();

  const patchSignal = useMutation({
    mutationFn: (body: { approvalStatus: string }) =>
      api.patch(`/training/screenshots/review/voice-signals/${signal.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['training', 'fragments'] });
      onUpdate();
    },
  });

  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <Badge variant="default" className="shrink-0">
          {signal.signalType}
        </Badge>
        <span className="text-sm text-gray-700 truncate">{signal.signalValue}</span>
        {signal.evidenceText && (
          <span className="text-xs text-gray-400 italic truncate">
            &ldquo;{signal.evidenceText}&rdquo;
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {signal.approvalStatus === 'pending' ? (
          <>
            <button
              onClick={() => patchSignal.mutate({ approvalStatus: 'approved' })}
              className="p-1 text-gray-300 hover:text-emerald-500 transition-colors"
              title={t('training.approve')}
            >
              <CheckCircle2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => patchSignal.mutate({ approvalStatus: 'rejected' })}
              className="p-1 text-gray-300 hover:text-red-500 transition-colors"
              title={t('training.reject')}
            >
              <XCircle className="h-4 w-4" />
            </button>
          </>
        ) : (
          <Badge variant={signal.approvalStatus === 'approved' ? 'success' : 'error'}>
            {signal.approvalStatus}
          </Badge>
        )}
      </div>
    </div>
  );
}

/* --- Bot Analysis Panel ------------------------------------------ */

function BotAnalysisPanel({ fragment }: { fragment: ExtractedFragment }) {
  const { t } = useT();
  const cls = fragment.classificationJson;

  const templateColor =
    fragment.templateScenario === 'handoff'
      ? 'text-amber-600 bg-amber-50 border-amber-200'
      : fragment.templateScenario === 'ai_fallback'
        ? 'text-purple-600 bg-purple-50 border-purple-200'
        : fragment.templateScenario
          ? 'text-blue-600 bg-blue-50 border-blue-200'
          : 'text-gray-400 bg-gray-50 border-gray-200';

  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
        <Bot className="h-3.5 w-3.5" />
        {t('training_ext.bot_analysis')}
      </div>

      {cls && (
        <div className="flex flex-wrap gap-1.5">
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
            {cls.primaryIntent}
          </span>
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
            {cls.slotAction}
          </span>
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
            {cls.sentiment}
          </span>
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">
            {Math.round(cls.confidence * 100)}%
          </span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">{t('training_ext.bot_template')}:</span>
        <span className={`px-2 py-0.5 rounded border text-xs font-medium ${templateColor}`}>
          {fragment.templateScenario ?? t('training_ext.bot_no_template')}
        </span>
      </div>

      {fragment.botReply && (
        <div>
          <p className="text-xs text-gray-400 mb-1">{t('training_ext.bot_would_reply')}:</p>
          <div className="flex justify-start">
            <div className="max-w-[90%] px-3 py-2 rounded-xl rounded-bl-sm text-sm bg-indigo-100 text-indigo-900 border border-indigo-200">
              {fragment.botReply}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* --- Fragment Card ------------------------------------------------ */

function FragmentCard({ fragment }: { fragment: ExtractedFragment }) {
  const { t } = useT();
  const qc = useQueryClient();

  const invalidateFragments = () => {
    qc.invalidateQueries({ queryKey: ['training', 'fragments'] });
  };

  const patchFragment = useMutation({
    mutationFn: (body: { reviewStatus: string }) =>
      api.patch(`/training/screenshots/review/fragments/${fragment.id}`, body),
    onSuccess: invalidateFragments,
  });

  const applyFragment = useMutation({
    mutationFn: () =>
      api.post(`/training/screenshots/review/fragments/${fragment.id}/apply`),
    onSuccess: invalidateFragments,
  });

  const analyzeFragment = useMutation({
    mutationFn: () =>
      api.post(`/training/screenshots/review/fragments/${fragment.id}/analyze`),
    onSuccess: invalidateFragments,
  });

  return (
    <Card>
      <div className="flex gap-4">
        {/* Screenshot thumbnail */}
        {fragment.file?.fileUrl && (
          <div className="shrink-0">
            <img
              src={fragment.file.fileUrl}
              alt={fragment.file.fileName}
              className="h-32 w-24 rounded-lg object-cover border border-gray-200"
            />
          </div>
        )}

        <div className="flex-1 min-w-0 space-y-3">
          {/* Header row */}
          <div className="flex items-center gap-2 flex-wrap">
            {fragment.scenarioSuggestion && (
              <Badge variant="default">{fragment.scenarioSuggestion}</Badge>
            )}
            {fragment.source === 'live_observation' && (
              <Badge variant="pending">{t('training_ext.source_live')}</Badge>
            )}
            <span className="text-xs text-gray-400">
              {t('training_ext.confidence')}: {Math.round((fragment.confidenceScore ?? 0) * 100)}%
            </span>
            <Badge
              variant={
                fragment.reviewStatus === 'approved'
                  ? 'success'
                  : fragment.reviewStatus === 'rejected'
                    ? 'error'
                    : 'pending'
              }
            >
              {fragment.reviewStatus}
            </Badge>
          </div>

          {/* Chat transcript */}
          {fragment.transcriptJson && fragment.transcriptJson.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
              <ChatTranscript turns={fragment.transcriptJson} />
            </div>
          )}

          {/* Bot engine analysis (live observations only) */}
          {fragment.source === 'live_observation' && (fragment.classificationJson || fragment.templateScenario) && (
            <BotAnalysisPanel fragment={fragment} />
          )}

          {/* Phrases */}
          {fragment.phrases && fragment.phrases.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                {t('training_ext.extracted_phrases')}
              </p>
              <div className="divide-y divide-gray-50">
                {fragment.phrases.map((p) => (
                  <PhraseRow key={p.id} phrase={p} onUpdate={invalidateFragments} />
                ))}
              </div>
            </div>
          )}

          {/* Voice signals */}
          {fragment.voiceSignals && fragment.voiceSignals.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                {t('training_ext.voice_signals')}
              </p>
              <div className="divide-y divide-gray-50">
                {fragment.voiceSignals.map((s) => (
                  <VoiceSignalRow key={s.id} signal={s} onUpdate={invalidateFragments} />
                ))}
              </div>
            </div>
          )}

          {/* Analyze button for unanalyzed live observation fragments */}
          {fragment.source === 'live_observation' && !fragment.scenarioSuggestion && (
            <div className="pt-1">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => analyzeFragment.mutate()}
                loading={analyzeFragment.isPending}
              >
                <Wand2 className="h-3.5 w-3.5" />
                {t('training_ext.analyze')}
              </Button>
              {analyzeFragment.isError && (
                <span className="text-xs text-red-500 ml-2">{t('training_ext.analyze_failed')}</span>
              )}
            </div>
          )}

          {/* Actions */}
          {fragment.reviewStatus === 'pending' && (
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => patchFragment.mutate({ reviewStatus: 'approved' })}
                loading={patchFragment.isPending}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t('training.approve')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => patchFragment.mutate({ reviewStatus: 'rejected' })}
                loading={patchFragment.isPending}
              >
                <XCircle className="h-3.5 w-3.5" />
                {t('training.reject')}
              </Button>
            </div>
          )}

          {fragment.reviewStatus === 'approved' && (
            <div className="pt-1">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => applyFragment.mutate()}
                loading={applyFragment.isPending}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t('training_ext.apply_training')}
              </Button>
              {applyFragment.isSuccess && (
                <span className="text-xs text-emerald-600 ml-2">{t('training_ext.applied')}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/* --- Review Tab -------------------------------------------------- */

type SourceFilter = 'all' | 'screenshot' | 'live_observation';

function ReviewTab() {
  const { t } = useT();
  const [source, setSource] = useState<SourceFilter>('all');

  const { data: fragments, isLoading } = useQuery<ExtractedFragment[]>({
    queryKey: ['training', 'fragments', source],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (source !== 'all') params.source = source;
      return api.get('/training/screenshots/review/fragments', { params }).then((r) => r.data);
    },
  });

  const sourceOptions: { value: SourceFilter; label: string }[] = [
    { value: 'all', label: t('training_ext.source_all') },
    { value: 'screenshot', label: t('training_ext.source_screenshot') },
    { value: 'live_observation', label: t('training_ext.source_live') },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {sourceOptions.map((o) => (
          <button
            key={o.value}
            onClick={() => setSource(o.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              source === o.value
                ? 'bg-amber-400 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <LoadingState message={t('training_ext.loading_fragments')} />
      ) : !fragments || fragments.length === 0 ? (
        <Card>
          <EmptyState
            icon={Image}
            title={t('training_ext.no_fragments')}
            description={t('training_ext.upload_process_desc')}
          />
        </Card>
      ) : (
        <>
          <p className="text-xs text-gray-400">
            {t('training_ext.fragments_pending', { count: fragments.length })}
          </p>
          {fragments.map((f) => (
            <FragmentCard key={f.id} fragment={f} />
          ))}
        </>
      )}
    </div>
  );
}

/* --- Training Page ----------------------------------------------- */

export default function TrainingPage() {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('upload');

  const tabLabels: Record<Tab, string> = {
    upload: t('training_ext.upload_tab'),
    review: t('training_ext.review_tab'),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{t('training.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {t('training.subtitle')}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {(['upload', 'review'] as const).map((tabKey) => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              tab === tabKey
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            {tabLabels[tabKey]}
          </button>
        ))}
      </div>

      {tab === 'upload' ? <UploadTab /> : <ReviewTab />}
    </div>
  );
}
