/**
 * useSkillDetail - Skill detail drawer state hook
 */

import { useRef, useState } from 'react';

const API = '/skills-management/api';

export interface SkillFileInfo {
  path: string;
  size: number;
  modifiedAt: string;
}

export interface SkillDetailData {
  name: string;
  shortName: string;
  dir: string;
  isInstalled: boolean;
  content: string;
  contentWithMeta: string;
  meta: Record<string, any>;
  files: SkillFileInfo[];
  fileCount: number;
  totalSize: number;
  modifiedAt?: string;
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

export interface SkillDetailState {
  selectedSkill: SkillMeta | null;
  drawerOpen: boolean;
  detail: SkillDetailData | null;
  contentLoading: boolean;
  openDetail: (skill: SkillMeta) => Promise<void>;
  closeDetail: () => void;
}

export function useSkillDetail(): SkillDetailState {
  const [selectedSkill, setSelectedSkill] = useState<SkillMeta | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detail, setDetail] = useState<SkillDetailData | null>(null);
  const [contentLoading, setContentLoading] = useState(false);

  const detailReqIdRef = useRef(0);

  const openDetail = async (skill: SkillMeta) => {
    const reqId = ++detailReqIdRef.current;
    setSelectedSkill(skill);
    setDrawerOpen(true);
    setDetail(null);
    setContentLoading(true);

    try {
      const res = await fetch(API + '/detail?name=' + encodeURIComponent(skill.name));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      
      if (reqId !== detailReqIdRef.current) return;
      setDetail(data);
    } catch (e) {
      if (reqId !== detailReqIdRef.current) return;
      console.error('Failed to load skill detail:', e);
    } finally {
      if (reqId === detailReqIdRef.current) setContentLoading(false);
    }
  };

  const closeDetail = () => setDrawerOpen(false);

  return {
    selectedSkill,
    drawerOpen,
    detail,
    contentLoading,
    openDetail,
    closeDetail,
  };
}
