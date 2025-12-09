import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Trash2, 
  RotateCcw, 
  FolderOpen, 
  AlertTriangle,
  Archive,
  CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import * as api from "@/lib/api";
import type { Project } from "@/lib/api";
import { cn } from "@/lib/utils";

interface DeletedProjectsProps {
  /**
   * Callback when a project is restored
   */
  onProjectRestored?: () => void;
  /**
   * Optional className for styling
   */
  className?: string;
}

/**
 * Component for managing deleted/hidden projects
 * Allows users to restore or permanently delete projects
 */
export const DeletedProjects: React.FC<DeletedProjectsProps> = ({
  onProjectRestored,
  className
}) => {
  const [deletedProjects, setDeletedProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [permanentDeleteDialog, setPermanentDeleteDialog] = useState<{
    open: boolean;
    projectId: string | null;
  }>({ open: false, projectId: null });
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load hidden projects with intelligent path detection
  const loadDeletedProjects = async () => {
    try {
      setLoading(true);
      
      // Get list of hidden project IDs (now with intelligent directory validation)
      const hiddenIds = await api.api.listHiddenProjects();
      
      if (hiddenIds.length === 0) {
        setDeletedProjects([]);
        setLoading(false);
        return;
      }
      
      // Create project objects with improved path decoding
      const projects: Project[] = [];
      
      for (const projectId of hiddenIds) {
        // Improved path decoding logic
        let decodedPath = projectId;
        
        // Handle single-dash format (Claude CLI standard)
        if (projectId.includes('-') && !projectId.includes('--')) {
          decodedPath = projectId
            .replace(/-/g, '/')
            .replace(/^C\//, 'C:/')
            .replace(/^\/+/, '/');
        }
        // Handle double-dash format (legacy claude-workbench)
        else if (projectId.includes('--')) {
          decodedPath = projectId
            .replace(/--/g, '/')
            .replace(/^C\//, 'C:/')
            .replace(/^\/+/, '/');
        }
        
        // Create project (format type will be determined in UI)
        
        projects.push({
          id: projectId,
          path: decodedPath,
          sessions: [],
          created_at: Date.now() / 1000
        });
      }
      
      setDeletedProjects(projects);
    } catch (error) {
      console.error("Failed to load deleted projects:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDeletedProjects();
  }, []);

  // Restore a project
  const handleRestore = async (projectId: string) => {
    try {
      setRestoring(projectId);
      await api.api.restoreProject(projectId);
      
      // Show success message
      setSuccessMessage(`项目已成功恢复`);
      setTimeout(() => setSuccessMessage(null), 3000);
      
      // Reload the list
      await loadDeletedProjects();
      
      // Notify parent component
      if (onProjectRestored) {
        onProjectRestored();
      }
    } catch (error) {
      console.error("Failed to restore project:", error);
    } finally {
      setRestoring(null);
    }
  };

  // Permanently delete a project (remove from file system)
  const handlePermanentDelete = async () => {
    if (!permanentDeleteDialog.projectId) return;

    try {
      setLoading(true);

      // Permanently delete the project files
      await api.api.deleteProjectPermanently(permanentDeleteDialog.projectId);

      // Show success message
      setSuccessMessage(`项目已永久删除`);
      setTimeout(() => setSuccessMessage(null), 3000);

      setPermanentDeleteDialog({ open: false, projectId: null });
      await loadDeletedProjects();

      // Note: We don't call onProjectRestored() here because:
      // 1. The project is permanently deleted, not restored
      // 2. Calling it would trigger unnecessary parent re-renders
      // 3. The deleted projects list is already updated via loadDeletedProjects()
    } catch (error) {
      console.error("Failed to permanently delete project:", error);
      setSuccessMessage(`删除失败: ${error}`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (deletedProjects.length === 0) {
    return (
      <div className="text-center py-12">
        <Archive className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-medium mb-2">没有已删除的项目</h3>
        <p className="text-sm text-muted-foreground">
          当你删除项目时，它们会显示在这里以便恢复
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Success message */}
      <AnimatePresence>
        {successMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800 dark:text-green-200">
                {successMessage}
              </AlertDescription>
            </Alert>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Info alert */}
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>已删除的项目</AlertTitle>
        <AlertDescription>
          这些项目已被隐藏但文件仍然保留。你可以恢复它们或永久删除。
        </AlertDescription>
      </Alert>

      {/* Deleted projects list */}
      <div className="space-y-3">
        {deletedProjects.map((project, index) => (
          <motion.div
            key={project.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: index * 0.05 }}
          >
            <div className="p-4 rounded-xl bg-card border border-border/40 shadow-sm hover:shadow-md transition-all duration-300">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-muted/50 text-muted-foreground shrink-0">
                    <FolderOpen className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground/80 truncate">
                      {project.path.split(/[\\\/]/).pop() || project.path}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono truncate mt-0.5 bg-muted/30 inline-block px-1.5 py-0.5 rounded">
                      {project.path}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3 ml-4">
                  <Badge variant="secondary" className="shrink-0 bg-muted/50 text-muted-foreground hover:bg-muted/50">
                    已删除
                  </Badge>
                  
                  {/* Format indicator for debugging */}
                  {project.id.includes('--') && (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      旧格式
                    </Badge>
                  )}
                  
                  <div className="flex items-center gap-1 border-l pl-3 ml-1 border-border/50">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRestore(project.id)}
                      disabled={restoring === project.id}
                      className="h-8 text-primary hover:text-primary hover:bg-primary/10"
                      title="恢复项目"
                    >
                      {restoring === project.id ? (
                        <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-primary border-t-transparent" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                      <span className="ml-2 sr-only">恢复</span>
                    </Button>
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPermanentDeleteDialog({ 
                        open: true, 
                        projectId: project.id 
                      })}
                      className="h-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                      title="永久删除"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="ml-2 sr-only">永久删除</span>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Permanent delete confirmation dialog */}
      <Dialog 
        open={permanentDeleteDialog.open} 
        onOpenChange={(open) => setPermanentDeleteDialog({ 
          open, 
          projectId: null 
        })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>永久删除项目？</DialogTitle>
            <DialogDescription>
              此操作将永久删除项目及其所有文件。此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPermanentDeleteDialog({ 
                open: false, 
                projectId: null 
              })}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handlePermanentDelete}
            >
              永久删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};