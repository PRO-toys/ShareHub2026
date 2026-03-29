import { Router, Request, Response } from 'express';
import { listEvents, getEvent, createEvent, updateEvent } from '../db/database';

const { nanoid } = require('nanoid') as { nanoid: (size?: number) => string };

const router = Router();

/** GET /api/events — List all events */
router.get('/', (_req: Request, res: Response) => {
  res.json(listEvents());
});

/** GET /api/events/:id — Get event detail */
router.get('/:id', (req: Request, res: Response) => {
  const event = getEvent(req.params.id as string);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json(event);
});

/** POST /api/events — Create event */
router.post('/', (req: Request, res: Response) => {
  const { name, date, project_folder, location_type, cloud_config, theme_id } = req.body;

  if (!name || !date) {
    return res.status(400).json({ error: 'name and date required' });
  }

  const id = nanoid(16);
  createEvent({ id, name, date, project_folder, location_type, cloud_config, theme_id });
  res.status(201).json(getEvent(id));
});

/** PUT /api/events/:id — Update event */
router.put('/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const event = getEvent(id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  updateEvent(id, req.body);
  res.json(getEvent(id));
});

export default router;
