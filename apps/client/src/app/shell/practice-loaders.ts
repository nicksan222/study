import { materialIdSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';

import type { AppRouterContext } from '#client/app/router-context.ts';
import { materialId } from '#client/features/material-library/index.ts';
import type { AppSearch } from '#client/lib/navigation/route-contract.ts';
import { sidebarOwner } from '#client/lib/study-client/sidebar-owner.queries.ts';

export const materialSidebar = {
  owner: sidebarOwner(materialIdSchema, (params) => params.materialId, 'material')
};

export const validateMaterialParams = ({ params }: { params: { materialId: string } }) => {
  materialId(params.materialId);
};

export const materialLoaderDeps = ({ search }: { search: AppSearch }) => ({
  version: search.version,
  attempt: search.attempt
});

export const loadMaterial = ({
  params
}: {
  context: AppRouterContext;
  params: { materialId: string };
}) => rpc.materials.get.read({ id: materialId(params.materialId) }).catch(() => undefined);
