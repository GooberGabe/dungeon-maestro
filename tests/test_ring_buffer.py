import unittest

import numpy as np

from dungeon_maestro_sidecar.ring_buffer import AudioRingBuffer


class AudioRingBufferTests(unittest.TestCase):
    def test_append_and_snapshot_preserve_order(self):
        buffer = AudioRingBuffer(max_samples=10)
        buffer.append(np.array([0.1, 0.2], dtype=np.float32))
        buffer.append(np.array([0.3, 0.4], dtype=np.float32))

        snapshot = buffer.snapshot()
        self.assertTrue(np.allclose(snapshot, np.array([0.1, 0.2, 0.3, 0.4], dtype=np.float32)))
        self.assertEqual(buffer.total_samples, 4)

    def test_trim_discards_oldest_chunks(self):
        buffer = AudioRingBuffer(max_samples=4)
        buffer.append(np.array([1.0, 2.0], dtype=np.float32))
        buffer.append(np.array([3.0, 4.0], dtype=np.float32))
        buffer.append(np.array([5.0, 6.0], dtype=np.float32))

        snapshot = buffer.snapshot()
        self.assertTrue(np.allclose(snapshot, np.array([3.0, 4.0, 5.0, 6.0], dtype=np.float32)))
        self.assertEqual(buffer.total_samples, 4)

    def test_clear_resets_state(self):
        buffer = AudioRingBuffer(max_samples=4)
        buffer.append(np.array([1.0, 2.0], dtype=np.float32))
        buffer.clear()

        self.assertEqual(buffer.total_samples, 0)
        self.assertEqual(buffer.snapshot().size, 0)


if __name__ == "__main__":
    unittest.main()
