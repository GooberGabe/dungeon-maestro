import tempfile
import unittest
from pathlib import Path

from dungeon_maestro_sidecar.config import load_pipeline_config


EXAMPLE_CONFIG = """
settings:
  default_soundscape: starter
soundscapes:
  starter:
    name: Starter Soundscape
    keywords: ["start"]
    tracks:
      - source: test track one
    playback:
      mode: sequential_loop
      startup_mode: no_preload
"""


class ConfigIntegrationTests(unittest.TestCase):
    def test_load_pipeline_config_from_yaml_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "dungeon-maestro.yaml"
            config_path.write_text(EXAMPLE_CONFIG, encoding="utf-8")

            settings, soundscapes = load_pipeline_config(config_path)

        self.assertEqual(settings.default_soundscape, "starter")
        self.assertEqual(len(soundscapes), 1)
        self.assertEqual(soundscapes[0].soundscape_id, "starter")
        self.assertEqual(soundscapes[0].tracks[0].source, "test track one")


if __name__ == "__main__":
    unittest.main()
