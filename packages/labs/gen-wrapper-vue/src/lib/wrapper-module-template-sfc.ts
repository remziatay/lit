/**
 * @license
 * Copyright 2022 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {
  LitElementDeclaration,
  PackageJson,
  getImportsStringForReferences,
} from '@lit-labs/analyzer';

import {
  ReactiveProperty as ModelProperty,
  Event as EventModel,
} from '@lit-labs/analyzer/lib/model.js';
import {javascript, kabobToOnEvent} from '@lit-labs/gen-utils/lib/str-utils.js';

/**
 * Generates a Vue wrapper component as a Vue single file component. This
 * approach relies on the Vue compiler to generate a Javascript property types
 * object for Vue runtime type checking from the Typescript property types.
 */
export const wrapperModuleTemplateSFC = (
  packageJson: PackageJson,
  moduleJsPath: string,
  elements: LitElementDeclaration[]
) => {
  const wcPath = `${packageJson.name}/${moduleJsPath}`;
  return elements.map((element) => [
    element.name!,
    wrapperTemplate(element, wcPath),
  ]);
};

const defaultEventType = `CustomEvent<unknown>`;

const getEventInfo = (event: EventModel) => {
  const {name, type: modelType} = event;
  const onName = kabobToOnEvent(name);
  const type = modelType?.text ?? defaultEventType;
  return {onName, type};
};

const renderPropsInterface = (props: Map<string, ModelProperty>) =>
  `export interface Props {
     ${Array.from(props.values())
       .map((prop) => `${prop.name}?: ${prop.type?.text || 'any'}`)
       .join(';\n     ')}
   }`;

const wrapEvents = (events: Map<string, EventModel>) =>
  Array.from(events.values())
    .map((event) => {
      const {type} = getEventInfo(event);
      return `(e: '${event.name}', payload: ${type}): void`;
    })
    .join(',\n');

/**
 * Generates VNode props for events. Note that vue automatically maps
 * event names from e.g. `event-name` to `onEventName`.
 */
const renderEvents = (events: Map<string, EventModel>) =>
  javascript`{
    ${Array.from(events.values())
      .map((event) => {
        const {onName, type} = getEventInfo(event);
        return `${onName}: (event: ${type}) => emit('${event.name}', event as ${type})`;
      })
      .join(',\n')}
  }`;

const getTypeReferencesForMap = (
  map: Map<string, ModelProperty | EventModel>
) => Array.from(map.values()).flatMap((e) => e.type?.references ?? []);

const getElementTypeImports = (declaration: LitElementDeclaration) => {
  const {events, reactiveProperties} = declaration;
  const refs = [
    ...getTypeReferencesForMap(events),
    ...getTypeReferencesForMap(reactiveProperties),
  ];
  return getImportsStringForReferences(refs);
};

const getElementTypeExportsFromImports = (imports: string) =>
  imports.replace(/(?:^import|(\s)*import)/gm, '$1export type');

// TODO(sorvell): Add support for `v-bind`.
const wrapperTemplate = (
  declaration: LitElementDeclaration,
  wcPath: string
) => {
  const {tagname, events, reactiveProperties} = declaration;
  const typeImports = getElementTypeImports(declaration);
  const typeExports = getElementTypeExportsFromImports(typeImports);
  return javascript`${
    typeExports
      ? javascript`
    <script lang="ts">
      ${typeExports}
    </script>`
      : ''
  }
    <script setup lang="ts">
      import { h, useSlots } from "vue";
      import { assignSlotNodes, Slots, vProps } from "@lit-labs/vue-utils/wrapper-utils.js";
      import '${wcPath}';
      ${typeImports}

      ${renderPropsInterface(reactiveProperties)}

      const props = defineProps<Props>();

      ${
        events.size
          ? javascript`const emit = defineEmits<{
        ${wrapEvents(events)}
      }>();`
          : ''
      }

      const slots = useSlots();

      const render = () => {
        const staticProps = ${renderEvents(events)};

        return h(
          '${tagname}',
          staticProps,
          assignSlotNodes(slots as Slots)
        );
      };
    </script>
    <template><render v-props="props" /></template>`;
};
