# Android Review set audio focus

Passive Review set speech holds transient, may-duck audio focus for its active playback scope in both standalone sessions and mini interval sessions. Standalone sessions hold focus while running with cards available. Mini sessions use the same focus controller while a running, Review-enabled step has cards and does not require confirmation. Pausing, completing, stopping, or leaving an eligible step releases the scope; shared leases prevent one Review session from restoring other media while another scope remains active.
