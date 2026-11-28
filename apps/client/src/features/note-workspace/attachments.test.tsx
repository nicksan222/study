import { test } from '@study/testing';
import { AttachmentPreview, WorkspaceDeskSurface as Desk } from '@study/ui';

test.unit.stable.for([
  ['audio', 'audio/mpeg'],
  ['video', 'video/mp4']
] as const)(
  'uses native %s controls outside the attachment navigation link',
  ([kind, mime], { render, expect, screen }) => {
    const view = render(
      <Desk.AttachmentCard
        name="Lecture"
        meta="Attached"
        icon={null}
        href="/reader"
        preview={
          <AttachmentPreview kind={kind} src="blob:local-media" mime={mime} label="Lecture" />
        }
      />
    );
    const player = view.container.querySelector(kind);

    expect(player).toHaveAttribute('controls');
    expect(player).toHaveAttribute('preload', 'metadata');
    expect(player).not.toHaveAttribute('autoplay');
    expect(player?.querySelector('source')).toHaveAttribute('src', 'blob:local-media');
    expect(player?.closest('a,button')).toBeNull();
    expect(screen.getByRole('link', { name: /Lecture/ })).toHaveAttribute('href', '/reader');
  }
);
