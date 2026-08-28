/**
 * useSkillCatalog — 技能市场目录（列表/分页/视图/筛选）数据族 hook
 * Ported from ntd frontend/src/hooks/useSkillCatalog.ts
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const API = '/skills-management/api';
const PAGE_SIZE = 30;

export interface SkillSourceMeta {
  source: string;
  skills: number;
  displayName: string;
}

export interface SkillMeta {
  name: string;
  shortName: string;
  source: string;
  description: string;
  keywords: string[];
  version?: string;
  installed: boolean;
  totalSize: number;
}

export interface InstalledSkillMeta {
  name: string;
  description: string;
  path: string;
  fileCount: number;
  totalSize: number;
  modifiedAt?: string;
}

export interface SkillDetailData {
  name: string;
  shortName: string;
  dir: string;
  isInstalled: boolean;
  content: string;
  contentWithMeta: string;
  meta: Record<string, any>;
  files: { path: string; size: number; modifiedAt: string }[];
  fileCount: number;
  totalSize: number;
  modifiedAt?: string;
}

type ViewMode = 'browse-sources' | 'all-skills' | 'installed';

export interface SkillCatalogState {
  skills: SkillMeta[];
  sources: SkillSourceMeta[];
  installed: InstalledSkillMeta[];
  loading: boolean;
  total: number;
  viewMode: ViewMode;
  activeSource: string | null;
  searchText: string;
  filterSource: string;
  browseSourcesPage: number;
  browseSkillsPage: number;
  allPage: number;
  setSearchText: (v: string) => void;
  setFilterSource: (v: string) => void;
  setBrowseSourcesPage: (v: number) => void;
  setBrowseSkillsPage: (v: number) => void;
  setAllPage: (v: number) => void;
  switchToSourceBrowse: () => void;
  switchToAllSkills: () => void;
  switchToInstalled: () => void;
  enterSource: (sourceKey: string) => void;
  backToSourceGrid: () => void;
  refresh: () => void;
}

export function useSkillCatalog(): SkillCatalogState & { message: { error: (msg: string) => void } } {
  // ── Data states ──
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [sources, setSources] = useState<SkillSourceMeta[]>([]);
  const [installed, setInstalled] = useState<InstalledSkillMeta[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Pagination states ──
  const [browseSourcesPage, setBrowseSourcesPage] = useState(1);
  const [browseSkillsPage, setBrowseSkillsPage] = useState(1);
  const [allPage, setAllPage] = useState(1);
  const [total, setTotal] = useState(0);

  // ── View states ──
  const [viewMode, setViewMode] = useState<ViewMode>('browse-sources');
  const [activeSource, setActiveSource] = useState<string | null>(null);

  // ── Filter states ──
  const [searchText, setSearchText] = useState('');
  const [filterSource, setFilterSource] = useState<string>('all');

  // Request race guard
  const reqGenRef = useRef(0);

  // ── Load data ──
  const loadData = useCallback(async () => {
    const myGen = ++reqGenRef.current;
    setLoading(true);
    try {
      const res = await fetch(API);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (myGen !== reqGenRef.current) return;

      setSources(data.sources || []);
      setSkills(data.market || []);
      setInstalled(data.installed || []);
      setTotal((data.market || []).length);
    } catch (e: any) {
      if (myGen !== reqGenRef.current) return;
      console.error('Failed to load skills:', e);
    } finally {
      if (myGen === reqGenRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── View switchers ──
  const switchToSourceBrowse = useCallback(() => {
    setViewMode('browse-sources');
    setActiveSource(null);
    setSearchText('');
    setBrowseSourcesPage(1);
    setBrowseSkillsPage(1);
  }, []);

  const switchToAllSkills = useCallback(() => {
    setViewMode('all-skills');
    setActiveSource(null);
    setFilterSource('all');
    setSearchText('');
    setAllPage(1);
  }, []);

  const switchToInstalled = useCallback(() => {
    setViewMode('installed');
    setActiveSource(null);
    setSearchText('');
  }, []);

  const enterSource = useCallback((sourceKey: string) => {
    setActiveSource(sourceKey);
    setBrowseSkillsPage(1);
    setSearchText('');
  }, []);

  const backToSourceGrid = useCallback(() => {
    setActiveSource(null);
    setBrowseSkillsPage(1);
    setBrowseSourcesPage(1);
  }, []);

  const refresh = useCallback(() => {
    loadData();
  }, [loadData]);

  // Simple message mock (DSH uses App.useApp())
  const message = {
    error: (msg: string) => console.error(msg),
  };

  return {
    skills,
    sources,
    installed,
    loading,
    total,
    viewMode,
    activeSource,
    searchText,
    filterSource,
    browseSourcesPage,
    browseSkillsPage,
    allPage,
    setSearchText,
    setFilterSource,
    setBrowseSourcesPage,
    setBrowseSkillsPage,
    setAllPage,
    switchToSourceBrowse,
    switchToAllSkills,
    switchToInstalled,
    enterSource,
    backToSourceGrid,
    refresh,
    message,
  };
}

export { PAGE_SIZE as ALL_SKILLS_PAGE_SIZE };
