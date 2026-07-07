"""Per-version project data (attributes / results / treatment / snapshot).

Extracted from ``project_manager`` (S3.6). ``ProjectVersion`` owns a single
dated version folder and is responsible for three concerns, kept together
because they share the class's lazy-loading state:

* **defaults** — the on-disk file-name constants (``STR_*``) and the empty
  serializer instances used when constructing an in-memory version.
* **data access** — the lazily-parsed ``snapshot_metadata`` / ``attributes`` /
  ``results`` / ``treatment`` properties.
* **serialization / mutation** — ``load_all`` / ``save_all`` and the
  ``delete_segment(s)`` helpers.

Re-exported from ``app.services.project_manager`` to keep the historical import
path stable.
"""
from __future__ import annotations
import datetime
import app.services.serializer as serializer
import pandas as pd
from pathlib import Path


# Handles the specific project version and data
class ProjectVersion:
    STR_SNAPSHOT_METADATA   = "snapshot_metadata.csv"
    STR_ATTRIBUTES          = "attributes.csv"
    STR_RESULTS             = "results.csv"
    STR_TREATMENT           = "treatment.csv"

    def __init__(self, version_path: Path = None) -> None:
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
    def snapshot_metadata(self, value: serializer.SnapshotMetadata) -> None:
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
    def attributes(self, value: serializer.Attributes) -> None:
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
    def results(self, value: serializer.Results) -> None:
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
    def treatment(self, value: serializer.Treatment) -> None:
        if not isinstance(value, serializer.Treatment):
            raise TypeError("metadata must be serializer.Treatment")
        self._treatment = value
        self._treatment.df_dirty = True
        # print(f"SETTING TREATMENTS TO {value.df}")

    # ─── Convenience helpers ─────────────────────────────────
    def load_all(self) -> None:
        _ = (
            self.snapshot_metadata,
            self.attributes,
            self.results,
            self.treatment,
        )

    def save_all(self) -> None:
        if self.snapshot_metadata.df_dirty is True:
            self.snapshot_metadata.serialize(self.path / self.STR_SNAPSHOT_METADATA)
        if self.attributes.df_dirty is True:
            self.attributes.serialize(self.path / self.STR_ATTRIBUTES)
        if self.results.df_dirty is True:
            self.results.serialize(self.path / self.STR_RESULTS)
        if self.treatment.df_dirty is True:
            self.treatment.serialize(self.path / self.STR_TREATMENT)



    def delete_segment(self, index: int) -> None:
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
    def delete_segments(self, indices: list[int]) -> None:
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
