import { memo } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical, Trash2 } from "lucide-react";
import type { ImageEntry } from "@framenote/core";
import { useAssetUrl } from "../hooks/useAssetUrl";
import { IconButton } from "./primitives";

export function Filmstrip({
  assignmentId,
  images,
  selectedId,
  onSelect,
  onReorder,
  onRemove,
}: {
  assignmentId: string;
  images: ImageEntry[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onRemove: (id: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = images.map((i) => i.id);

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    onReorder(arrayMove(ids, from, to));
  };
  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= ids.length) return;
    onReorder(arrayMove(ids, index, to));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className="filmstrip" aria-label="Images in this assignment">
          {images.map((img, i) => (
            <FilmstripItem
              key={img.id}
              assignmentId={assignmentId}
              image={img}
              index={i}
              count={images.length}
              selected={img.id === selectedId}
              onSelect={onSelect}
              onMove={move}
              onRemove={onRemove}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

const FilmstripItem = memo(function FilmstripItem({
  assignmentId,
  image,
  index,
  count,
  selected,
  onSelect,
  onMove,
  onRemove,
}: {
  assignmentId: string;
  image: ImageEntry;
  index: number;
  count: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onMove: (index: number, delta: number) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: image.id });
  const url = useAssetUrl(assignmentId, image.thumbnail);
  return (
    <li
      ref={setNodeRef}
      className={`film-item ${selected ? "is-selected" : ""} ${isDragging ? "is-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button type="button" className="film-thumb" onClick={() => onSelect(image.id)} aria-current={selected ? "true" : undefined}>
        {url ? <img src={url} alt="" loading="lazy" draggable={false} /> : <span className="film-thumb-empty" />}
        <span className="film-index mono">{index + 1}</span>
        <span className="sr-only">
          Image {index + 1}: {image.user.caption || image.originalFilename}
        </span>
      </button>
      <div className="film-actions">
        <IconButton label={`Drag to reorder image ${index + 1}`} className="drag-handle" {...attributes} {...listeners}>
          <GripVertical size={16} />
        </IconButton>
        <IconButton label={`Move image ${index + 1} up`} disabled={index === 0} onClick={() => onMove(index, -1)}>
          <ChevronUp size={16} />
        </IconButton>
        <IconButton label={`Move image ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(index, 1)}>
          <ChevronDown size={16} />
        </IconButton>
        <IconButton label={`Remove image ${index + 1}`} onClick={() => onRemove(image.id)}>
          <Trash2 size={15} />
        </IconButton>
      </div>
    </li>
  );
});
