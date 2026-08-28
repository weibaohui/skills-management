/**
 * useSkillInstall - Skill install state hook
 */

import { useState, useCallback } from 'react';
import { SkillMeta } from './useSkillDetail';

const API = '/skills-management/api';

export interface SkillInstallState {
  installModalOpen: boolean;
  installing: boolean;
  installResult: { success: number; failed: number } | null;
  openInstall: (skill: SkillMeta) => void;
  closeInstall: () => void;
  install: (skill: SkillMeta) => Promise<void>;
}

export function useSkillInstall(onDone?: () => void): SkillInstallState {
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<{ success: number; failed: number } | null>(null);
  const [targetSkill, setTargetSkill] = useState<SkillMeta | null>(null);

  const openInstall = (skill: SkillMeta) => {
    setTargetSkill(skill);
    setInstallModalOpen(true);
    setInstallResult(null);
  };

  const closeInstall = () => {
    setInstallModalOpen(false);
    setInstallResult(null);
    setTargetSkill(null);
  };

  const install = async (skill: SkillMeta) => {
    setInstalling(true);
    setInstallResult(null);

    try {
      const res = await fetch(API + '/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: skill.name }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || 'HTTP ' + res.status);
      }

      setInstallResult({ success: 1, failed: 0 });
      console.log('Install success:', skill.shortName || skill.name);
      onDone?.();
      
      setTimeout(() => { closeInstall(); }, 1500);
    } catch (e) {
      setInstallResult({ success: 0, failed: 1 });
      console.error('Install failed:', e);
    } finally {
      setInstalling(false);
    }
  };

  return {
    installModalOpen,
    installing,
    installResult,
    openInstall,
    closeInstall,
    install,
  };
}
