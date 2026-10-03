//! Drawing the measurement: the hardware at a glance, where each local model runs and
//! why, and the finer numbers.

use super::super::settings_card;
use crate::ui::screens::shell::page::pages::components::badge;
use crate::ui::screens::shell::page::pages::components::pill;
use crate::ui::screens::shell::page::*;
use gpui_kit::assets::IconName;
use gpui_kit::component::ActiveTheme as _;
use gpui_kit::{
    App, Div, FontWeight, ParentElement as _, SharedString, Styled as _,
    prelude::FluentBuilder as _,
};
use study_app::benchmark::Report;
use study_app::benchmark::{HEADROOM_BYTES, Placement, Reason};
use study_localization::{
    bandwidth, copies, cpu_thread_count, gflops, joined, listed, media_size, memory_free,
    memory_gib, operating_system, seconds_taken,
};
use study_ui::{scaled_px, units};

/// A titled group, spaced a little wider than the other settings groups for its figures.
fn section(title: &'static str, cx: &App) -> Div {
    settings_card(title, cx).gap(scaled_px(cx, study_ui::scale::SPACE_SM))
}

/// The processor by name, then one tile per headline number.
pub(super) fn hardware(report: &Report, locale: Locale, cx: &App) -> Div {
    let colors = cx.theme().colors;
    let unit = units(cx);
    let system = &report.system;
    let compute = &report.compute;
    let os = operating_system(&system.os, system.os_version.as_deref());
    let cores = system.cores();
    let threads = cpu_thread_count(locale, system.logical_cores);
    let (matmul, matmul_unit) = gflops(compute.matmul_gflops);
    let (speed, speed_unit) = bandwidth(locale, compute.memory_bandwidth_gbps);
    let available = system.available_memory_bytes;
    let total = system.total_memory_bytes.max(1);
    let used = 1. - (available as f32 / total as f32).clamp(0., 1.);
    let meter = div()
        .mt(unit(8.))
        .w_full()
        .h(unit(4.))
        .rounded(unit(study_ui::scale::RADIUS_SM))
        .bg(colors.border.opacity(0.6))
        .child(
            div()
                .h_full()
                .w(gpui_kit::relative(used))
                .rounded(unit(study_ui::scale::RADIUS_SM))
                .bg(colors.muted_foreground),
        );
    let tiles = div()
        .w_full()
        .flex()
        .flex_wrap()
        .gap(unit(10.))
        .child(tile(
            IconName::Cpu,
            text(locale, Message::SysCores),
            cores.to_string(),
            threads,
            None,
            cx,
        ))
        .child(tile(
            IconName::MemoryStick,
            text(locale, Message::SysMemory),
            memory_gib(locale, system.total_memory_bytes),
            memory_free(locale, available),
            Some(meter),
            cx,
        ))
        .child(tile(
            IconName::Zap,
            text(locale, Message::SysMatmul),
            matmul,
            matmul_unit,
            None,
            cx,
        ))
        .child(tile(
            IconName::Gauge,
            text(locale, Message::SysBandwidth),
            speed,
            speed_unit,
            None,
            cx,
        ));
    section(text(locale, Message::SysDetected), cx)
        .child(
            div()
                .w_full()
                .flex()
                .items_center()
                .gap(unit(12.))
                .child(badge(IconName::Monitor, colors.muted_foreground, 16., cx))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .gap(unit(2.))
                        .child(
                            div()
                                .text_size(unit(study_ui::scale::TEXT_BODY))
                                .font_weight(FontWeight::MEDIUM)
                                .child(SharedString::from(system.cpu_brand.clone())),
                        )
                        .child(
                            div()
                                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                                .text_color(colors.muted_foreground)
                                .child(SharedString::from(joined(&[os, system.arch.clone()]))),
                        ),
                ),
        )
        .child(tiles)
}

/// One headline number: what it is, the number, and its unit or context, as plain text in a
/// column that shares the row, with no tile around it.
fn tile(
    name: IconName,
    label: &'static str,
    value: String,
    caption: String,
    extra: Option<Div>,
    cx: &App,
) -> Div {
    let colors = cx.theme().colors;
    let unit = units(cx);
    div()
        .flex_1()
        .min_w(unit(150.))
        .py(unit(study_ui::scale::SPACE_XXS))
        .flex()
        .flex_col()
        .gap(unit(4.))
        .child(
            div()
                .flex()
                .items_center()
                .gap(unit(6.))
                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                .text_color(colors.muted_foreground)
                .child(study_ui::icon(name).size(unit(14.)))
                .child(label),
        )
        .child(
            div()
                .flex()
                .items_baseline()
                .gap(unit(6.))
                .child(
                    div()
                        .text_size(unit(study_ui::scale::TEXT_BODY))
                        .font_weight(FontWeight::MEDIUM)
                        .child(SharedString::from(value)),
                )
                .child(
                    div()
                        .text_size(unit(study_ui::scale::TEXT_CAPTION))
                        .text_color(colors.muted_foreground)
                        .child(SharedString::from(caption)),
                ),
        )
        .children(extra)
}

/// Whether the search model is installed, and how much installing it downloads.
#[derive(Clone, Copy)]
pub(super) struct SearchModel {
    pub(super) installed: bool,
    pub(super) size_bytes: u64,
}

/// Each model that runs on this computer, and whether it can here, with why. Everything
/// else runs on the ChatGPT plan.
pub(super) fn placements(report: &Report, search: SearchModel, locale: Locale, cx: &App) -> Div {
    let plan = report.plan();
    let instances = plan
        .transcription_instances
        .map(|instances| copies(locale, instances.as_usize()));
    let rows = [
        (
            IconName::AudioLines,
            Message::SysTranscription,
            plan.transcription,
            instances,
        ),
        (
            IconName::Search,
            Message::SysSearch,
            // Always here: search never sends text to another computer.
            Placement::Local,
            Some(if search.installed {
                text(locale, Message::ModelInstalled).to_owned()
            } else {
                joined(&[
                    text(locale, Message::SearchModelMissing).to_owned(),
                    media_size(locale, search.size_bytes as i64),
                ])
            }),
        ),
    ];
    let border = cx.theme().colors.border;
    let mut list = div().w_full().flex().flex_col();
    for (index, (name, label, placement, detail)) in rows.into_iter().enumerate() {
        list = list.child(
            placement_row(name, text(locale, label), placement, detail, locale, cx)
                .when(index > 0, |row| {
                    row.border_t_1().border_color(border.opacity(0.6))
                }),
        );
    }
    section(text(locale, Message::SysDecided), cx).child(list)
}

fn placement_row(
    name: IconName,
    label: &'static str,
    placement: Placement,
    detail: Option<String>,
    locale: Locale,
    cx: &App,
) -> Div {
    let colors = cx.theme().colors;
    let unit = units(cx);
    let (tint, state, detail) = match placement {
        Placement::Local => (study_ui::palette(cx).faint, Message::RunsHere, detail),
        Placement::NotHere(reason) => {
            let why = match reason {
                Reason::NotEnoughMemory => Message::PlacementNotEnoughMemory,
                Reason::TooSlow => Message::PlacementTooSlow,
            };
            (
                colors.muted_foreground,
                Message::NotRecommendedHere,
                Some(text(locale, why).to_owned()),
            )
        }
    };
    div()
        .w_full()
        .py(unit(10.))
        .flex()
        .items_center()
        .gap(unit(12.))
        .child(badge(name, colors.muted_foreground, 16., cx))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(unit(2.))
                .child(div().text_size(unit(study_ui::scale::TEXT_UI)).child(label))
                .children(detail.map(|detail| {
                    div()
                        .text_size(unit(study_ui::scale::TEXT_CAPTION))
                        .text_color(colors.muted_foreground)
                        .child(SharedString::from(detail))
                })),
        )
        .child(pill(tint, cx).child(text(locale, state)))
}

/// The numbers only a curious reader needs, as quiet label and value pairs.
pub(super) fn details(report: &Report, locale: Locale, cx: &App) -> Div {
    let colors = cx.theme().colors;
    let unit = units(cx);
    let system = &report.system;
    let spare = system.available_memory_bytes.saturating_sub(HEADROOM_BYTES);
    let simd = if system.simd.is_empty() {
        text(locale, Message::SysNone).to_owned()
    } else {
        listed(&system.simd)
    };
    let fields = [
        (Message::SysSpare, memory_gib(locale, spare)),
        (
            Message::SysMemoryAvailable,
            memory_gib(locale, system.available_memory_bytes),
        ),
        (
            Message::SysMeasuredIn,
            seconds_taken(locale, report.elapsed_secs),
        ),
        (Message::SysSimd, simd),
    ];
    let mut grid = div().w_full().flex().flex_wrap().gap_y(unit(10.));
    for (label, value) in fields {
        grid = grid.child(
            div()
                .w(gpui_kit::relative(0.5))
                .min_w(unit(220.))
                .pr(unit(16.))
                .flex()
                .flex_col()
                .gap(unit(2.))
                .child(
                    div()
                        .text_size(unit(study_ui::scale::TEXT_CAPTION))
                        .text_color(colors.muted_foreground)
                        .child(text(locale, label)),
                )
                .child(
                    div()
                        .text_size(unit(study_ui::scale::TEXT_SMALL))
                        .child(SharedString::from(value)),
                ),
        );
    }
    section(text(locale, Message::SysMeasured), cx).child(grid)
}
