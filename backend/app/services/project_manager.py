from __future__ import annotations
import re
import os
import json
import datetime
import hashlib
import app.services.global_var as global_var
import app.services.serializer as serializer
import pandas as pd
import shutil
import geopandas as gpd
import app.services.cycleRAP_interface as cycleRAP_interface
from pathlib import Path
from shapely.geometry import LineString, Point
from shapely import wkt
from app.services.cycleRAP_VA import gdfify, get_full_path


def materialize_project_image(source_img_path: Path, target_img_path: Path) -> str:
    """Create a project-local image entry without duplicating bytes when possible.

    Prefer a hard link so projects can keep their own stable image names while
    sharing the underlying file data with the source folder. Fall back to a
    normal copy if the filesystem does not allow linking (for example, cross-
    volume moves).
    """
    target_img_path.parent.mkdir(parents=True, exist_ok=True)

    if target_img_path.exists():
        if target_img_path.is_file():
            target_img_path.unlink()
        else:
            raise IsADirectoryError(f"Target image path is not a file: {target_img_path}")

    try:
        os.link(source_img_path, target_img_path)
        return "hardlink"
    except OSError:
        shutil.copy2(source_img_path, target_img_path)
        return "copy"


def _hash_file_sha256(file_path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with open(file_path, "rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _next_dedupe_backup_path(target_path: Path) -> Path:
    candidate = target_path.with_name(f"{target_path.name}.dedupe-backup")
    index = 2
    while candidate.exists():
        candidate = target_path.with_name(f"{target_path.name}.dedupe-backup-{index}")
        index += 1
    return candidate


def _replace_with_hardlink(canonical_path: Path, duplicate_path: Path) -> tuple[bool, str | None]:
    backup_path = _next_dedupe_backup_path(duplicate_path)

    try:
        duplicate_path.replace(backup_path)
    except OSError as exc:
        return False, str(exc)

    try:
        os.link(canonical_path, duplicate_path)
    except OSError as exc:
        backup_path.replace(duplicate_path)
        return False, str(exc)

    backup_path.unlink()
    return True, None


def deduplicate_project_images(projects_root: Path, project_names: list[str] | None = None) -> dict:
    root = Path(projects_root).resolve()
    summary = {
        "root": str(root),
        "scanned_projects": 0,
        "scanned_files": 0,
        "duplicates_found": 0,
        "deduplicated_files": 0,
        "already_linked": 0,
        "bytes_reclaimed": 0,
        "missing_projects": [],
        "skipped": [],
    }

    if not root.exists() or not root.is_dir():
        return summary

    requested_names = None
    if project_names is not None:
        requested_names = sorted({str(name or "").strip() for name in project_names if str(name or "").strip()})

    if requested_names is None:
        project_dirs = sorted((child for child in root.iterdir() if child.is_dir()), key=lambda path: path.name.lower())
    else:
        project_dirs = []
        for name in requested_names:
            project_dir = root / name
            if project_dir.is_dir():
                project_dirs.append(project_dir)
            else:
                summary["missing_projects"].append(name)

    summary["scanned_projects"] = len(project_dirs)
    canonical_by_fingerprint: dict[tuple[int, str], Path] = {}

    for project_dir in project_dirs:
        images_dir = project_dir / global_var.PROJECT_IMAGES_FOLDER
        if not images_dir.is_dir():
            continue

        for image_path in sorted((child for child in images_dir.iterdir() if child.is_file()), key=lambda path: path.name.lower()):
            try:
                size = image_path.stat().st_size
                fingerprint = (size, _hash_file_sha256(image_path))
            except OSError as exc:
                summary["skipped"].append({
                    "project": project_dir.name,
                    "file": image_path.name,
                    "reason": str(exc),
                })
                continue

            summary["scanned_files"] += 1
            canonical_path = canonical_by_fingerprint.get(fingerprint)
            if canonical_path is None:
                canonical_by_fingerprint[fingerprint] = image_path
                continue

            summary["duplicates_found"] += 1
            try:
                if image_path.samefile(canonical_path):
                    summary["already_linked"] += 1
                    continue
            except OSError as exc:
                summary["skipped"].append({
                    "project": project_dir.name,
                    "file": image_path.name,
                    "reason": str(exc),
                })
                continue

            relinked, reason = _replace_with_hardlink(canonical_path, image_path)
            if relinked:
                summary["deduplicated_files"] += 1
                summary["bytes_reclaimed"] += size
            else:
                summary["skipped"].append({
                    "project": project_dir.name,
                    "file": image_path.name,
                    "reason": str(reason or "Unknown hard-link error"),
                })

    return summary

# Handles the specific project version and data
class ProjectVersion:
    STR_SNAPSHOT_METADATA   = "snapshot_metadata.csv"
    STR_ATTRIBUTES          = "attributes.csv"
    STR_RESULTS             = "results.csv"
    STR_TREATMENT           = "treatment.csv"

    def __init__(self, version_path: Path = None):
        self.path = version_path                      # …/ProjectA/20250416
        if version_path is not None:
            self.date = datetime.datetime.strptime(version_path.name, "%Y%m%d").date()
            self._snapshot_metadata : None | serializer.SnapshotMetadata    = None
            self._attributes : None | serializer.Attributes                 = None
            self._treatment : None | serializer.Treatment                   = None
            self._results : None | serializer.Results                       = None

        elif version_path is None:
            self.date = datetime.datetime.now().strftime("%Y%m%d")
            self._snapshot_metadata : serializer.SnapshotMetadata   = serializer.SnapshotMetadata()
            self._attributes        : serializer.Attributes         = serializer.Attributes()
            self._treatment         : serializer.Treatment          = serializer.Treatment()
            self._results           : serializer.Results            = serializer.Results()



    @property
    def snapshot_metadata(self) -> serializer.SnapshotMetadata:
        if self._snapshot_metadata is None:
            snapshot = serializer.SnapshotMetadata()
            path = self.path / self.STR_SNAPSHOT_METADATA
            if path.exists():
                snapshot.parse(path)
            else:
                snapshot.df = pd.DataFrame()
                snapshot.df_dirty = True
            self._snapshot_metadata = snapshot
        return self._snapshot_metadata

    @snapshot_metadata.setter
    def snapshot_metadata(self, value: serializer.SnapshotMetadata):
        if not isinstance(value, serializer.SnapshotMetadata):
            raise TypeError("metadata must be serializer.SnapshotMetadata")
        self._snapshot_metadata = value
        self._snapshot_metadata.df_dirty = True

    @property
    def attributes(self) -> serializer.Attributes:
        if self._attributes is None:
            attr = serializer.Attributes()
            attr.parse(self.path / self.STR_ATTRIBUTES)
            self._attributes = attr
        return self._attributes

    @attributes.setter
    def attributes(self, value: serializer.Attributes):
        if not isinstance(value, serializer.Attributes):
            raise TypeError("metadata must be serializer.Attributes")
        self._attributes = value
        self._attributes.df_dirty = True
        # print(f"SETTING ATTRIBUTES TO {value.df}")

    @property
    def results(self) -> serializer.Results:
        if self._results is None:
            res = serializer.Results()
            res.parse(self.path / self.STR_RESULTS)
            self._results = res
        return self._results

    @results.setter
    def results(self, value: serializer.Results):
        if not isinstance(value, serializer.Results):
            raise TypeError("metadata must be serializer.Results")
        self._results = value
        self._results.df_dirty = True
        # print(f"SETTING RESULTS TO {value.df}")

    @property
    def treatment(self) -> serializer.Treatment:
        if self._treatment is None:
            tmp_treatment = serializer.Treatment()
            tmp_treatment.parse(self.path / self.STR_TREATMENT)
            self._treatment = tmp_treatment
        return self._treatment

    @treatment.setter
    def treatment(self, value: serializer.Treatment):
        if not isinstance(value, serializer.Treatment):
            raise TypeError("metadata must be serializer.Treatment")
        self._treatment = value
        self._treatment.df_dirty = True
        # print(f"SETTING TREATMENTS TO {value.df}")

    # ─── Convenience helpers ─────────────────────────────────
    def load_all(self):
        _ = (
            self.snapshot_metadata,
            self.attributes,
            self.results,
            self.treatment,
        )

    def save_all(self):
        if self.snapshot_metadata.df_dirty is True:
            self.snapshot_metadata.serialize(self.path / self.STR_SNAPSHOT_METADATA)
        if self.attributes.df_dirty is True:
            self.attributes.serialize(self.path / self.STR_ATTRIBUTES)
        if self.results.df_dirty is True:
            self.results.serialize(self.path / self.STR_RESULTS)
        if self.treatment.df_dirty is True:
            self.treatment.serialize(self.path / self.STR_TREATMENT)



    def delete_segment(self, index: int):
        # 1. Delete from Snapshot Metadata
        if self.snapshot_metadata.df is not None and index < len(self.snapshot_metadata.df):
            self.snapshot_metadata.df = self.snapshot_metadata.df.drop(index).reset_index(drop=True)
            self.snapshot_metadata.df_dirty = True

        # 2. Delete from Attributes
        if self.attributes.df is not None and index < len(self.attributes.df):
            self.attributes.df = self.attributes.df.drop(index).reset_index(drop=True)
            self.attributes.df_dirty = True

        # 3. Delete from Results
        if self.results.df is not None and len(self.results.df) > index:
            self.results.df = self.results.df.drop(index).reset_index(drop=True)
            self.results.df_dirty = True

        # 4. Delete from Treatment
        if self.treatment.df is not None and len(self.treatment.df) > index:
            self.treatment.df = self.treatment.df.drop(index).reset_index(drop=True)
            self.treatment.df_dirty = True
    def delete_segments(self, indices: list[int]):
        # Batch delete from all dataframes
        # Filter indices to ensure they are valid for each dataframe if sizes differ (though they shouldn't)
        
        # 1. Snapshot Metadata
        if self.snapshot_metadata.df is not None:
            valid_indices = [i for i in indices if i < len(self.snapshot_metadata.df)]
            if valid_indices:
                self.snapshot_metadata.df = self.snapshot_metadata.df.drop(valid_indices).reset_index(drop=True)
                self.snapshot_metadata.df_dirty = True

        # 2. Attributes
        if self.attributes.df is not None:
            valid_indices = [i for i in indices if i < len(self.attributes.df)]
            if valid_indices:
                self.attributes.df = self.attributes.df.drop(valid_indices).reset_index(drop=True)
                self.attributes.df_dirty = True

        # 3. Results
        if self.results.df is not None:
            valid_indices = [i for i in indices if i < len(self.results.df)]
            if valid_indices:
                self.results.df = self.results.df.drop(valid_indices).reset_index(drop=True)
                self.results.df_dirty = True

        # 4. Treatment
        if self.treatment.df is not None:
            valid_indices = [i for i in indices if i < len(self.treatment.df)]
            if valid_indices:
                self.treatment.df = self.treatment.df.drop(valid_indices).reset_index(drop=True)
                self.treatment.df_dirty = True

# In charge of the selection of project versions and project metadata
class Project:
    def __init__(self, project_path: Path = None):
        self.project_path = project_path               #  …/ProjectA
        self._metadata : serializer.ProjectMetadata | None  = None
        self._geo_data : serializer.ProjectGeoData  | None  = None
        self._meta_dirty = False
        self._geo_dirty = False
        self.versions: list[ProjectVersion] = []

        if project_path is None:
            self._metadata : serializer.ProjectMetadata = serializer.ProjectMetadata()
            self._geo_data : serializer.ProjectGeoData  = serializer.ProjectGeoData()
            self.versions.insert(0, ProjectVersion())

    # ─── Version handling ─────────────────────────────────────
    def _discover_versions(self):
        version_dir = self.project_path / "versions"
        self.versions: list[ProjectVersion] = [
            ProjectVersion(p)
            for p in version_dir.iterdir()
            if p.is_dir() and p.name.isdigit() and len(p.name) == 8
        ]
        self.versions.sort(key=lambda v: v.date, reverse=True) # v is a ProjectVersion object, reverse=True sorts date in descending order

    def latest(self) -> ProjectVersion:
        if not self.versions:
            self._discover_versions()
            if not self.versions:
                raise ValueError(f"No dated sub-folders in {self.project_path}")
        return self.versions[0]

    def by_date(self, yyyymmdd: str) -> ProjectVersion:
        for v in self.versions:
            if v.path.name == yyyymmdd:
                return v
        raise ValueError(f"{yyyymmdd} not found in {self.project_path}")
    
    def create_new_version(self, version : ProjectVersion = None) -> ProjectVersion:
        yyyymmdd = datetime.datetime.now().strftime("%Y%m%d")
        ver_path = self.project_path / "versions" / yyyymmdd

        # 2) bail out if already present ---------------------------------------
        if ver_path.exists():
            raise FileExistsError(f"Version {yyyymmdd} already exists in {self.project_path}")

        # 3) create the directory ----------------------------------------------
        ver_path.mkdir(parents=True)

        # 4) build ProjectVersion object & register it -------------------------
        if version is not None:
            ver_obj = version
            ver_obj.path = ver_path
            # Mark all data as dirty so it gets saved to the new version directory
            # This ensures attributes, snapshot_metadata, etc. are copied forward
            # Access properties (not _internal) to trigger lazy loading if needed
            try:
                ver_obj.attributes.df_dirty = True
            except Exception:
                pass  # If attributes can't be loaded, skip
            try:
                ver_obj.snapshot_metadata.df_dirty = True
            except Exception:
                pass
            try:
                ver_obj.treatment.df_dirty = True
            except Exception:
                pass
            try:
                ver_obj.results.df_dirty = True
            except Exception:
                pass
        else:
            ver_obj = ProjectVersion(ver_path)

        self.versions.insert(0, ver_obj)

        return ver_obj
    
    def save_all(self):
        yyyymmdd = datetime.datetime.now().strftime("%Y%m%d")
        today_ver_path = self.project_path / "versions" / yyyymmdd
        if not today_ver_path.exists():
            # Only create a new version when today's directory does not yet exist
            self.create_new_version(self.latest())

        # NOTE: metadata is NOT serialized here intentionally.
        # Callers are responsible for setting last_updated and calling
        # metadata.serialize() explicitly, so only the intended project
        # gets its timestamp updated.
        if self.geo_data.df_dirty is True:
            self.geo_data.serialize(self.project_path)
        self.latest().save_all()
        return self.project_path
    
    def _delete(self):
        # Delete project directory
        shutil.rmtree(self.project_path, ignore_errors=True)

    def delete_segment(self, index: int):
        # 0. Delete Associated Image (from Geo Data info)
        try:
            if self.geo_data.df is not None and index < len(self.geo_data.df):
                row = self.geo_data.df.iloc[index]
                # Try common column names for image reference
                img_ref = None
                for col in ["Image Reference", "image", "img"]:
                    if col in row:
                        img_ref = row[col]
                        break
                
                if img_ref and isinstance(img_ref, str):
                    image_path = self.project_path / global_var.PROJECT_IMAGES_FOLDER / img_ref
                    if image_path.exists() and image_path.is_file():
                        os.remove(image_path)
        except Exception as e:
            print(f"Error deleting image for segment {index}: {e}")

        # Delete from Geo Data
        # Delete from Geo Data
        if self.geo_data.df is not None and index < len(self.geo_data.df):
            self.geo_data.df = self.geo_data.df.drop(index).reset_index(drop=True)
            self.geo_data.df_dirty = True
        
        # Delete from latest version data
        self.latest().delete_segment(index)

        # Update Metadata
        if self.metadata.size is not None and self.metadata.size > 0:
            self.metadata.size -= 1
        
        # We can't easily know if the deleted segment was verified or autocoded without checking previous state
        # But we can re-calculate verified count if needed, or just decrement if we tracked indices
        # For now, let's just save.
        
        self.save_all()

    def delete_segments(self, indices: list[int]):
        # 0. Delete Associated Images (from Geo Data info)
        try:
            if self.geo_data.df is not None:
                # Filter valid indices
                valid_indices = [i for i in indices if i < len(self.geo_data.df)]
                
                # Identify image paths to delete
                images_to_delete = []
                for idx in valid_indices:
                    row = self.geo_data.df.iloc[idx]
                    img_ref = None
                    for col in ["Image Reference", "image", "img"]:
                        if col in row:
                            img_ref = row[col]
                            break
                    
                    if img_ref and isinstance(img_ref, str):
                        image_path = self.project_path / global_var.PROJECT_IMAGES_FOLDER / img_ref
                        images_to_delete.append(image_path)
                
                # Delete images
                for img_path in images_to_delete:
                    try:
                        if img_path.exists() and img_path.is_file():
                            os.remove(img_path)
                    except Exception as e:
                        # Continue deleting others even if one fails
                        print(f"Error deleting image {img_path}: {e}")

        except Exception as e:
            print(f"Error in batch image deletion: {e}")

        # Delete from Geo Data
        if self.geo_data.df is not None:
            valid_indices = [i for i in indices if i < len(self.geo_data.df)]
            if valid_indices:
                self.geo_data.df = self.geo_data.df.drop(valid_indices).reset_index(drop=True)
                self.geo_data.df_dirty = True
        
        # Delete from latest version data
        self.latest().delete_segments(indices)

        # Update Metadata
        if self.metadata.size is not None:
            # We removed len(valid_indices), but safe to just recount or subtract
            # Recounting is safer if possible, but indices logic above assumes alignment
            # Subtracting the actual number of dropped rows
            count_removed = len(valid_indices) if 'valid_indices' in locals() else len(indices)
            self.metadata.size = max(0, self.metadata.size - count_removed)
        
        self.save_all()

        self.save_all()

    def check_collisions(self, indices: list[int], target_project: 'Project') -> list[str]:
        """
        Check if segments specified by indices already exist in target_project based on Image Reference.
        Returns a list of colliding Image References.
        """
        source_geo = self.geo_data.df
        valid_indices = [i for i in indices if i < len(source_geo)]
        if not valid_indices:
            return []
        
        subset_geo = source_geo.iloc[valid_indices]
        
        target_geo = target_project.geo_data.df
        if target_geo is None or target_geo.empty:
            return []
            
        collisions = []
        # optimization: get set of target image refs
        if "Image Reference" in target_geo.columns:
            # Drop NAs and ensure we ignore empty strings or "nan"
            # astype(str) converts NaN to "nan" if we are not careful with dropna first
            target_series = target_geo["Image Reference"].dropna()
            # Filter out empty or whitespace only strings, and literal "nan"
            target_imgs = {str(x) for x in target_series if str(x).strip() and str(x).lower() != 'nan'}
            
            source_name = self.metadata.project_name
            target_name = target_project.metadata.project_name

            for _, row in subset_geo.iterrows():
                img_ref = row.get("Image Reference")
                # Check for validity before string conversion to be safe
                if pd.notna(img_ref):
                    s_ref = str(img_ref).strip()
                    if s_ref and s_ref.lower() != 'nan':
                        # PREDICT renaming
                        check_ref = s_ref
                        if s_ref.startswith(source_name):
                             check_ref = s_ref.replace(source_name, target_name, 1)
                        
                        if check_ref in target_imgs:
                            collisions.append(check_ref)
        
        if collisions:
            print(f"DEBUG: Found {len(collisions)} collisions. Examples: {collisions[:3]}")
                
        return collisions

    def copy_segments(self, indices: list[int], target_project: 'Project', replace: bool = False):
        """
        Copy segments (and their images) specified by indices from self (source) to target_project.
        """
        # 1. Get filtered data from source (latest version + geo_data)
        # We can reuse the logic from search/create_temporary_project but specific to indices
        
        source_geo = self.geo_data.df
        source_attr = self.latest().attributes.df
        source_res = self.latest().results.df
        source_treat = self.latest().treatment.df
        source_imgs = []

        # Validate indices
        valid_indices = [i for i in indices if i < len(source_geo)]
        if not valid_indices:
            return 0

        # Extract rows
        # Extract rows
        # Use reindex instead of iloc to handle cases where other DFs might be shorter than geo_df
        # This aligns everything to valid_indices (based on geo_df), filling missing with NaN
        subset_geo = source_geo.iloc[valid_indices].copy().reset_index(drop=True)
        subset_attr = source_attr.reindex(valid_indices).copy().reset_index(drop=True)
        subset_res = source_res.reindex(valid_indices).copy().reset_index(drop=True)
        
        subset_treat = pd.DataFrame()
        if not source_treat.empty:
             subset_treat = source_treat.reindex(valid_indices).copy().reset_index(drop=True)

        # 1.5 Handle Replacement
        if replace and target_project.geo_data.df is not None and not target_project.geo_data.df.empty:
            target_geo = target_project.geo_data.df
            target_geo = target_project.geo_data.df
            # Update: We need to predict the new image names FIRST because we are going to rename them.
            # Logic: If source image matches "SourceProject_...", rename to "TargetProject_..."
            # Then check if THAT new name exists in target.

            source_name = self.metadata.project_name
            target_name = target_project.metadata.project_name
            
            # Helper to predict name
            def predict_name(img_ref):
                if pd.isna(img_ref): return None
                s_ref = str(img_ref).strip()
                if not s_ref or s_ref.lower() == 'nan': return None
                
                # If starts with source project name (case-insensitive check), replace it
                # Otherwise, PREPEND target project name to enforce convention
                
                # Check 1: Exact match start
                if s_ref.startswith(source_name):
                    return s_ref.replace(source_name, target_name, 1)
                
                # Check 2: Case-insensitive match start
                if s_ref.lower().startswith(source_name.lower()):
                    # Retrieve the actual prefix length and slice
                    old_len = len(source_name)
                    suffix = s_ref[old_len:]
                    # If there was a separator (e.g. _) make sure we don't double it or lose it
                    # But simple concatenation is safest: TargetName + suffix
                    return f"{target_name}{suffix}"

                # Check 3: Force Prepend (if not already starting with target name)
                # If the image doesn't have the source prefix, the user wants it renamed to the new project.
                # e.g. "Cam1.jpg" -> "TargetProject_Cam1.jpg"
                if not s_ref.startswith(target_name):
                     return f"{target_name}_{s_ref}"

                return s_ref


            if "Image Reference" in target_geo.columns:
                # Identify images to replace (using PREDICTED names)
                img_refs_to_replace = set()
                for _, row in subset_geo.iterrows():
                    ref = row.get("Image Reference")
                    predicted = predict_name(ref)
                    if predicted:
                        img_refs_to_replace.add(predicted)
                
                if img_refs_to_replace:
                    # Find indices in target that match these images
                    # We iterate to find indices. 
                    # Note: target_geo index should be RangeIndex 0..N usually
                    # Safe boolean mask: convert target column to string, but handle NaNs carefully
                    # We only care about rows where Image Ref is in our set. 
                    
                    # 1. Ensure target column is treated as string for comparison, but keep index alignment
                    target_refs = target_geo["Image Reference"].astype(str)
                    
                    # 2. Check membership
                    mask = target_refs.isin(img_refs_to_replace)
                    indices_to_delete = target_geo[mask].index.tolist()
                    
                    if indices_to_delete:
                        # Batch delete them from target
                        target_project.delete_segments(indices_to_delete)
                        # Reload target_geo as it has changed
                        # Actually delete_segments modifies df in place (or reassigns it)
                        # But we should rely on the object state update.

        # 2. Copy Images
        # Target Image Directory
        target_img_dir = target_project.project_path / global_var.PROJECT_IMAGES_FOLDER
        if not target_img_dir.exists():
            target_img_dir.mkdir(parents=True, exist_ok=True)

        source_name = self.metadata.project_name
        target_name = target_project.metadata.project_name

        for idx, row in subset_geo.iterrows():
            img_ref = None
            col_name_found = None
            for col in ["Image Reference", "image", "img"]:
                if col in row and pd.notna(row[col]):
                    val = str(row[col]).strip()
                    if val and val.lower() != 'nan':
                        img_ref = val
                        col_name_found = col
                        break
            
            if img_ref:
                # Calculate new name using robust logic
                new_img_ref = img_ref
                
                # Check 1: Exact
                if img_ref.startswith(source_name):
                    new_img_ref = img_ref.replace(source_name, target_name, 1)
                # Check 2: Case insensitive
                elif img_ref.lower().startswith(source_name.lower()):
                    old_len = len(source_name)
                    suffix = img_ref[old_len:]
                    new_img_ref = f"{target_name}{suffix}"
                # Check 3: Force Prepend (if not already starting with target name)
                elif not img_ref.startswith(target_name):
                     new_img_ref = f"{target_name}_{img_ref}"

                # Update the dataframe (subset_geo) with the new name
                # This ensures when we append below, it has the correct reference
                subset_geo.at[idx, col_name_found] = new_img_ref
                # Also update treatment/results if they have the column? 
                # (Treatment has ImageReference, Results usually only lat/lon/scores)
                
                # Check treatment df
                if not subset_treat.empty and idx < len(subset_treat) and "Image Reference" in subset_treat.columns:
                     subset_treat.at[idx, "Image Reference"] = new_img_ref

                source_img_path = self.project_path / global_var.PROJECT_IMAGES_FOLDER / img_ref
                if source_img_path.exists():
                    target_img_path = target_img_dir / new_img_ref
                    materialize_project_image(source_img_path, target_img_path)


        # 3. Append to Target Project
        # Append GeoData
        if target_project.geo_data.df is None or target_project.geo_data.df.empty:
             target_project.geo_data.df = subset_geo
        else:
             target_project.geo_data.df = pd.concat([target_project.geo_data.df, subset_geo], ignore_index=True)
        target_project.geo_data.df_dirty = True

        # Append Attributes
        if target_project.latest().attributes.df is None or target_project.latest().attributes.df.empty:
            target_project.latest().attributes.df = subset_attr
        else:
            target_project.latest().attributes.df = pd.concat([target_project.latest().attributes.df, subset_attr], ignore_index=True)
        target_project.latest().attributes.df_dirty = True

        # Append Results
        if target_project.latest().results.df is None or target_project.latest().results.df.empty:
            target_project.latest().results.df = subset_res
        else:
            target_project.latest().results.df = pd.concat([target_project.latest().results.df, subset_res], ignore_index=True)
        target_project.latest().results.df_dirty = True

        # Append Treatment
        if target_project.latest().treatment.df is None or target_project.latest().treatment.df.empty:
            target_project.latest().treatment.df = subset_treat
        else:
            target_project.latest().treatment.df = pd.concat([target_project.latest().treatment.df, subset_treat], ignore_index=True)
        target_project.latest().treatment.df_dirty = True

        # 4. Update Target Metadata
        count_added = len(valid_indices)
        if target_project.metadata.size is None:
             target_project.metadata.size = 0
        target_project.metadata.size += count_added
        target_project.metadata.last_updated = datetime.datetime.now()
        
        # Save Target
        target_project.save_all()
        target_project.metadata.serialize(target_project.project_path)
        return count_added
        # ================================
        # Get dataframes to filter
        # ================================
        attr_df = self.latest().attributes.df
        treatment_df = self.latest().treatment.df
        results_df = self.latest().results.df
        geo_df = self.geo_data.df

        # ================================
        # Apply filters (AND logic between groups)
        # ================================

        # Start with all True masks
        attr_mask = pd.Series([True] * len(attr_df))
        treat_mask = pd.Series([True] * len(treatment_df))
        result_mask = pd.Series([True] * len(results_df))

        def map_labels_to_values(labels, value_map):
            """Helper to normalize single/multi inputs and map to stored values."""
            if not labels:
                return []
            label_list = labels if isinstance(labels, list) else [labels]
            return [value_map[label] for label in label_list if label in value_map]

        # === Filter attributes (OR per field) ===
        for field, labels in filter_attributes.items():
            if labels:
                value_map = serializer.Attributes.CHOICES.get(field, {})
                mapped_values = map_labels_to_values(labels, value_map)
                attr_mask &= attr_df[field].isin(mapped_values)

        # === TODO Filter treatment ===
        for field_key, values in filter_treatment.items():
            field_name = getattr(serializer.Treatment.Fields, field_key, None)
            if field_name and values:
                treat_mask &= treatment_df[field_name].isin(values)

        # === Filter results ===
        for field, labels in filter_results.items():
            if labels:
                if field in serializer.Results.FIELDS_META:
                    value_map = serializer.Results.FIELDS_META[field]
                    mapped_values = map_labels_to_values(labels, value_map)
                else:
                    mapped_values = labels if isinstance(labels, list) else [labels]

                result_mask &= results_df[field].isin(mapped_values)

        # ================================
        # Combine masks with AND across datasets
        # ================================
        combined_mask = attr_mask & result_mask
        selected_indexes = combined_mask[combined_mask].index

        # ================================
        # Package filtered data
        # ================================
        filtered_project = Project()  # No path needed for in-memory filtered version

        # Attributes
        filtered_project.latest()._attributes = serializer.Attributes()
        filtered_project.latest().attributes.df = attr_df.loc[selected_indexes].reset_index(drop=True)

        # Treatment
        filtered_project.latest()._treatment = serializer.Treatment()
        filtered_project.latest().treatment.df = treatment_df
        # filtered_project.latest()._treatment._df = treatment_df.loc[selected_indexes].reset_index(drop=True)

        # Results
        filtered_project.latest()._results = serializer.Results()
        filtered_project.latest().results.df = results_df.loc[selected_indexes].reset_index(drop=True)

        # Geo data
        filtered_project._geo_data = serializer.ProjectGeoData()
        filtered_project.geo_data.df = geo_df.loc[selected_indexes].reset_index(drop=True)
        filtered_project.geo_data.df = filtered_project.geo_data.df.set_geometry("geometry")

        # Metadata
        filtered_project.metadata = self.metadata  # Optionally deepcopy or set as-is

        return filtered_project

    # ─── Project-level metadata (non-versioned) ───────────────    
    @property
    def metadata(self) -> serializer.ProjectMetadata:
        if self._metadata is None:
            meta = serializer.ProjectMetadata()
            try:
                meta.parse(self.project_path / "project_metadata.json")
            except (FileNotFoundError, ValueError):
                # Fallback for corrupt/incomplete projects
                print(f"Warning: Could not read metadata for {self.project_path.name}")
                meta.project_name = self.project_path.name
            self._metadata = meta
        return self._metadata

    @metadata.setter
    def metadata(self, value: serializer.ProjectMetadata):
        if not isinstance(value, serializer.ProjectMetadata):
            raise TypeError("metadata must be serializer.ProjectMetadata")
        self._metadata = value
        self._meta_dirty = True      

    @property
    def geo_data(self) -> serializer.ProjectGeoData:
        if self._geo_data is None:
            geo_tbl = serializer.ProjectGeoData()
            geo_tbl.parse(self.project_path)
            self._geo_data = geo_tbl
        return self._geo_data

    @geo_data.setter
    def geo_data(self, value: serializer.ProjectGeoData):
        if not isinstance(value, serializer.ProjectGeoData):
            raise TypeError("metadata must be serializer.ProjectGeodata")
        self._geo_data = value
        self._geo_dirty = True
    
# Controller for managing the overall projects
class project_manager:
    DEFAULT_CONFIG = {
        # Folder paths
        "destination_folder": "../data",
        "source_folder": "src", 
        "in_folder": "../in",
        "CycleRAP_source": global_var.CYCLERAPVER,
        # Video config
        "capture_frequency": 10,  # GPS sampling rate in Hz
        # Name configurations
        "project_prefix": "",
        # Persistent states
        "current_project": None,
    }

    def __init__(self):
        # Path variables
        self.des_path : Path            = None
        self.src_path : Path            = None
        self.in_path  : Path            = None
        self.cycleRAP_model_src : Path  = None

        # Application-level variables
        self.shapefile                                                  = None
        self.capture_freq                                               = None

        # NOTE: Variable deprecated but still kept for backwards compatibility, 
        # Use the cycleRAP_interface class methods instead
        self.cyclerap_interface : cycleRAP_interface.cycleRAP_interface = cycleRAP_interface.cycleRAP_interface

        self._initialise()
    
    # Initialises all path and application-level variables
    def _initialise(self):
        # Create config if not existing
        if not get_config_path().exists():
            self.save_config(self.DEFAULT_CONFIG)

        try:
            with open(get_config_path(), 'r') as json_file:
                data = json.load(json_file)
        except (json.JSONDecodeError, ValueError):
            # Corrupted or empty config — recreate from defaults and retry once
            print("[PM] WARNING: config.json is corrupted, recreating from defaults.", flush=True)
            self.save_config(self.DEFAULT_CONFIG)
            with open(get_config_path(), 'r') as json_file:
                data = json.load(json_file)

        self.load_config(data)
        self._discover_projects()


# ================================================================================================================
# UTILITY
# ================================================================================================================
    def _discover_projects(self):
        if self.des_path is None:
            raise ValueError("self.des_path is not set. Please initialise it before discovering projects.")

        print(f"[PM] Discovering projects in: {self.des_path.resolve()}", flush=True)
        try:
            # NOTE: we might want to change to a random access data structure for more efficient look-up
            self.projects : list[Project] = [
                Project(p) for p in self.des_path.iterdir() if p.is_dir()
            ]
            print(f"[PM] Found {len(self.projects)} project(s).", flush=True)
        except FileNotFoundError:
            print(f"[PM] ERROR: Project destination folder '{self.des_path}' does not exist.", flush=True)
            self.projects = []
        except Exception as e:
            print(f"[PM] ERROR: Failed to discover projects: {e}", flush=True)
            self.projects = []

    def delete_project(self, project_name: str):
        for proj in self.projects:
            if proj.metadata.project_name == project_name:
                proj._delete()
                self.projects.remove(proj)
                return True
            
        raise KeyError(f"Project not found: {project_name}")

    def list_names(self):
        return [p.project_path.name for p in self.projects]
    
    def project(self, project_name: str) -> Project:
        for proj in self.projects:
            if proj.metadata.project_name ==  project_name:
                return proj
        raise KeyError(f"Project not found: {project_name}")
    
    def create_project(self, project_title, geo_data : gpd.geodataframe, dataset_name, tags=None, source_folders=None):
        proj_root = self.des_path / project_title

        # Image references come directly from geo_data FILENAME — no copying or renaming.
        # Images remain in in/ and are resolved at serve time.
        image_ref = list(geo_data["FILENAME"]) if "FILENAME" in geo_data.columns else []
        size = len(image_ref)

        # Craft project metadata
        now_dt = datetime.datetime.now()
        project_metadata = serializer.ProjectMetadata()
        project_metadata.project_name   = project_title
        project_metadata.date_created   = now_dt
        project_metadata.last_updated   = now_dt
        project_metadata.created_by     = "default"
        project_metadata.dataset        = dataset_name
        project_metadata.source_folders = source_folders if source_folders is not None else ([dataset_name] if dataset_name and dataset_name != "MULTI_FOLDER_SELECTION" else [])
        project_metadata.progress       = []
        project_metadata.size           = size
        project_metadata.tags           = tags if tags is not None else []

        # Craft geo data csv
        geo_tbl = serializer.ProjectGeoData(size)
        geo_tbl.loc[:, serializer.ProjectGeoData.Fields.IMAGE_REFERENCE_STR] = image_ref[:size]
        geo_tbl.populate_linestring(geo_data)

        # Craft version 1 snapshot metadata
        snapshot_dataframe = serializer.SnapshotMetadata(size)


        # Craft default attributes 
        attribute_dataframe = serializer.Attributes(size, self.cyclerap_interface.attribute_default_values)
        
        # Create project
        new_project = Project(proj_root)
        new_project.create_new_version()

        # Initialise project var
        new_project.geo_data = geo_tbl
        new_project.metadata = project_metadata
        new_project.latest().attributes = attribute_dataframe
        new_project.latest().snapshot_metadata = snapshot_dataframe
        # Treatment and Results should remain empty
        new_project.latest().results = serializer.Results()
        new_project.latest().treatment = serializer.Treatment()

        # Write project to file
        new_project.save_all()
        new_project.metadata.serialize(new_project.project_path)

        self.projects.append(new_project)
        
    # Search the entire project repository and create a temporary project based on the filter
    def create_temporary_project(self, filter_input : serializer.ProjectMetadata) -> Project:
        return self.merge_project_list(self.search(filter_input))

    def merge_project(self, lhs_name : str, rhs_name : str) -> Project:
        return self.project(lhs_name) + self.project(rhs_name)
    
    def merge_project_list(self, project_list : list[str] | list[Project]) -> Project:
        if all(isinstance(p, str) for p in project_list):
            project_list = [self.project(name) for name in project_list]
        
        merged = Project()

        # Change metadata
        merged.metadata.project_name = "Merged"

        # Merge geo data
        geo_dfs = [p.geo_data.df for p in project_list]
        merged._geo_data.df = pd.concat(geo_dfs, ignore_index=True)

        # Merge versions
        attr_dfs = [p.latest().attributes.df for p in project_list]
        merged.latest()._attributes._df = pd.concat(attr_dfs, ignore_index=True)

        result_dfs = [p.latest().results.df for p in project_list]
        merged.latest()._results._df = pd.concat(result_dfs, ignore_index=True)

        treatment_dfs = [p.latest().treatment.df for p in project_list]
        merged.latest()._treatment._df = pd.concat(treatment_dfs, ignore_index=True)
        
        snapshot_dfs = [p.latest().snapshot_metadata.df for p in project_list]
        merged.latest()._snapshot_metadata._df = pd.concat(snapshot_dfs, ignore_index=True)

        return merged


    # Search the project with the filter criteria
    def search(self, filter_input : serializer.ProjectMetadata = None, filter_attributes: dict = None, filter_treatment: dict = None, filter_results: dict = None) -> list[Project]:
        found : list[Project] = []

        for project in self.projects:
            meta = project.metadata
            match = True

            # Match progress (meta.progress <= filter_input.progress)
            # if ( meta.progress / meta.size * 100 ) > filter_input.progress:
            #     match = False
            #     continue

            # Match project_name (case-insensitive substring match to any name in the list)
            if filter_input.project_name:
                if not meta.project_name:
                    match = False
                    continue
                else:
                    # Ensure filter_input.project_name is a list
                    filter_names = filter_input.project_name if isinstance(filter_input.project_name, list) else [filter_input.project_name]
                    if not any(name.lower() in meta.project_name.lower() for name in filter_names):
                        match = False
                        continue

            # Match created_by (exact)
            if filter_input.created_by:
                if filter_input.created_by != meta.created_by:
                    match = False
                    continue

            # Match dataset (exact)
            if filter_input.dataset:
                if filter_input.dataset != meta.dataset:
                    match = False
                    continue

            # Match size (meta.size <= filter_input.size)
            if filter_input.size is not None:
                if meta.size is None or meta.size > filter_input.size:
                    match = False
                    continue

            # Match date_created <= filter_input.date_created
            if filter_input.date_created:
                if not meta.date_created or meta.date_created > filter_input.date_created:
                    match = False
                    continue

            # Match last_updated <= filter_input.last_updated
            if filter_input.last_updated:
                if not meta.last_updated or meta.last_updated > filter_input.last_updated:
                    match = False
                    continue

            # Match tags (all filter_input tags must be present in meta.tags)
            if filter_input.tags:
                # Normalize to list of lowercase tags (strip whitespace)
                if isinstance(filter_input.tags, str):
                    filter_tags = [t.strip().lower() for t in filter_input.tags.split(",") if t.strip()]
                elif isinstance(filter_input.tags, list):
                    filter_tags = [t.lower() for t in filter_input.tags if isinstance(t, str)]
                else:
                    filter_tags = []

                # Normalize meta tags too
                meta_tags = [t.lower() for t in (meta.tags or [])]

                # All filter tags must be present in meta tags
                if not all(tag in meta_tags for tag in filter_tags):
                    match = False
                    continue

            if match:
                found.append(project)

        return found

    
# ================================================================================================================
# SERIALIZATION
# ================================================================================================================

    def load_config(self, config):
        # Set paths from config
        self.des_path   = Path(get_full_path(config.get("destination_folder")))
        self.src_path   = Path(get_full_path(config.get("source_folder")))
        self.in_path    = Path(get_full_path(config.get("in_folder")))
        self.capture_freq       = config.get("capture_frequency")
        self.cycleRAP_model_src = config.get("CycleRAP_source")
        self.project_name       = config.get("current_project")

        return config

    def save_config(self, config):
        with open(get_config_path(), "w") as json_file:
            json.dump(config, json_file, indent=4)

    def write_config(self, key, value):
        with open(get_config_path(), "r") as json_file:
            data = json.load(json_file)
        data[key] = value
        self.save_config(data)

    # TODO (ONCE ACTIVE VERSION CONTROL HAS BEEN IMPLEMENTED): Project has to be opened to save
    def save_project(self, project_name: str = None) -> bool:
        pass

    # TODO (ONCE ACTIVE VERSION CONTROL HAS BEEN IMPLEMENTED): Loads all project-level variables from project directory
    def read_project(self, project_name: Path, best_before = None):
        self.project.project_path = self.des_path / project_name

        if best_before is not None:
            self.project.open_best_before(best_before)
        else:
            self.project.open_latest()
        pass


# ================================================================================================================
# LOCAL
# ================================================================================================================

def load_images_from_folder_cv(folder):
    image_array = []
    
    for filename in os.listdir(folder):
        if filename.lower().endswith((".jpg", ".jpeg")):
            image_array.append(filename)
    
    def extract_numeric_key(filename):
        # Search for "Cam" in the filename
        cam_match = re.search(r"Cam\d+", filename)
        
        if cam_match:
            # Extract from the Cam part onwards
            cam_section = filename[cam_match.start():]
            nums = re.findall(r'\d+', cam_section)
            if len(nums) >= 2:
                # Skip the camera number, use the remaining numeric parts
                key_str = "".join(nums[1:])
            else:
                key_str = "".join(nums)
        else:
            # No "Cam" found, fallback to all digits in full filename
            nums = re.findall(r'\d+', filename)
            key_str = "".join(nums) if nums else "0"
        
        return int(key_str)
    
    return sorted(image_array, key=extract_numeric_key)

def get_config_path():
    return Path(get_full_path("config.json"))

def rename_files_with_prefix(directory: str, prefix: str):
    """
    Rename all files in the given directory by adding a prefix to their filenames.

    Parameters:
        directory (str): Path to the target directory.
        prefix (str): Prefix to add to each file name.
    """
    dir_path = Path(directory)

    if not dir_path.is_dir():
        raise ValueError(f"The path '{directory}' is not a valid directory.")

    for file in dir_path.iterdir():
        if file.is_file():
            new_name = prefix + file.name
            new_path = file.with_name(new_name)
            file.rename(new_path)