use super::*;
use super::snap::is_snapped_frame;

	fn monitor(x: i32, width: u32, scale_milli: u32) -> MonitorBounds {
		MonitorBounds { x, y: 0, width, height: 1080, scale_milli }
	}

	fn saved(monitors: Vec<MonitorBounds>, rect: Bounds) -> SavedPlacement {
		SavedPlacement {
			version: STATE_VERSION,
			monitors,
			normal_position: rect,
			maximized: false,
			snapped: None,
		}
	}

	#[test]
	fn restores_valid_placement_on_unchanged_monitor() {
		let layout = vec![monitor(0, 1920, 1000)];
		let previous = saved(layout.clone(), Bounds { left: 320, top: 180, right: 1020, bottom: 850 });
		assert!(can_restore(&previous, &layout));
	}

	#[test]
	fn rejects_screen_size_scale_and_monitor_changes() {
		let layout = vec![monitor(0, 1920, 1000)];
		let previous = saved(layout.clone(), Bounds { left: 320, top: 180, right: 1020, bottom: 850 });
		assert!(!can_restore(&previous, &[monitor(0, 1280, 1000)]));
		assert!(!can_restore(&previous, &[monitor(0, 1920, 1250)]));
		assert!(!can_restore(&previous, &[monitor(0, 1920, 1000), monitor(-1920, 1920, 1000)]));
	}

	#[test]
	fn allows_negative_coordinates_on_secondary_monitor() {
		let mut layout = vec![monitor(0, 1920, 1000), monitor(-1920, 1920, 1000)];
		layout.sort();
		let previous = saved(layout.clone(), Bounds { left: -1300, top: 90, right: -600, bottom: 740 });
		assert!(can_restore(&previous, &layout));
	}

	#[test]
	fn rejects_offscreen_or_invalid_window_and_unknown_version() {
		let layout = vec![monitor(0, 1920, 1000)];
		let invalid = saved(layout.clone(), Bounds { left: 3000, top: 70, right: 3700, bottom: 750 });
		assert!(!can_restore(&invalid, &layout));
		let invalid_size = saved(layout.clone(), Bounds { left: 20, top: 20, right: 40, bottom: 30 });
		assert!(!can_restore(&invalid_size, &layout));
		let mut unknown_version = saved(layout.clone(), Bounds { left: 200, top: 50, right: 900, bottom: 720 });
		unknown_version.version = 99;
		assert!(!can_restore(&unknown_version, &layout));
	}

	#[test]
	fn rejects_corrupt_saved_json() {
		assert!(serde_json::from_slice::<SavedPlacement>(b"{not-json").is_err());
		assert!(serde_json::from_slice::<SavedPlacement>(br#"{"version":1}"#).is_err());
	}

	#[test]
	fn detects_left_right_and_quadrant_snap_without_maximization() {
		let work = Bounds { left: 0, top: 0, right: 1920, bottom: 1040 };
		assert!(is_snapped_frame(Bounds { left: 0, top: 0, right: 960, bottom: 1040 }, work));
		assert!(is_snapped_frame(Bounds { left: 960, top: 0, right: 1920, bottom: 1040 }, work));
		assert!(is_snapped_frame(Bounds { left: 0, top: 0, right: 960, bottom: 520 }, work));
		assert!(is_snapped_frame(Bounds { left: 960, top: 520, right: 1920, bottom: 1040 }, work));
		assert!(is_snapped_frame(Bounds { left: 640, top: 0, right: 1280, bottom: 1040 }, work));
		assert!(!is_snapped_frame(work, work));
		assert!(!is_snapped_frame(Bounds { left: 270, top: 180, right: 1200, bottom: 850 }, work));
		assert!(!is_snapped_frame(Bounds { left: 0, top: 80, right: 900, bottom: 850 }, work));
		let secondary = Bounds { left: -1920, top: 0, right: 0, bottom: 1040 };
		assert!(is_snapped_frame(Bounds { left: -1920, top: 0, right: -960, bottom: 1040 }, secondary));
	}

	#[test]
	fn snapped_save_round_trips_and_old_preferences_remain_valid() {
		let layout = vec![monitor(0, 1920, 1000)];
		let mut previous = saved(layout.clone(), Bounds { left: 200, top: 150, right: 1100, bottom: 880 });
		previous.snapped = Some(SnappedPlacement {
			outer_position: Bounds { left: -8, top: -8, right: 968, bottom: 1048 },
			visible_frame: Bounds { left: 0, top: 0, right: 960, bottom: 1040 },
			work_area: Bounds { left: 0, top: 0, right: 1920, bottom: 1040 },
		});
		assert!(can_restore(&previous, &layout));
		let snap = previous.snapped.as_ref().expect("snapped geometry");
		assert!(snap::work_area_unchanged(snap, Some(snap.work_area)));
		assert!(!snap::work_area_unchanged(snap, None));
		assert!(!snap::work_area_unchanged(snap, Some(Bounds {
			left: 0, top: 0, right: 1920, bottom: 1000,
		})));
		let data = serde_json::to_vec(&previous).expect("serialize snapped placement");
		let round_trip: SavedPlacement = serde_json::from_slice(&data).expect("parse snapped placement");
		assert!(can_restore(&round_trip, &layout));
		assert_eq!(round_trip.snapped.unwrap().outer_position.left, -8);
		let older = serde_json::to_value(saved(layout.clone(), Bounds { left: 200, top: 150, right: 1100, bottom: 880 }))
			.expect("serialize old placement");
		let older: SavedPlacement = serde_json::from_value(older).expect("parse old placement");
		assert!(older.snapped.is_none());
		assert!(can_restore(&older, &layout));
	}

	#[test]
	fn rejects_invalid_snap_geometry_and_changed_monitor() {
		let layout = vec![monitor(0, 1920, 1000)];
		let mut previous = saved(layout.clone(), Bounds { left: 200, top: 150, right: 1100, bottom: 880 });
		previous.snapped = Some(SnappedPlacement {
			outer_position: Bounds { left: -8, top: -8, right: 968, bottom: 1048 },
			visible_frame: Bounds { left: 0, top: 0, right: 960, bottom: 1040 },
			work_area: Bounds { left: 0, top: 0, right: 1920, bottom: 1040 },
		});
		assert!(!can_restore(&previous, &[monitor(0, 1280, 1000)]));
		previous.snapped.as_mut().unwrap().visible_frame.right = 1400;
		assert!(!can_restore(&previous, &layout));
		previous.snapped.as_mut().unwrap().visible_frame.right = 960;
		previous.maximized = true;
		assert!(!can_restore(&previous, &layout));
	}
