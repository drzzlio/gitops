{
  description = "GitOps Repo!!";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-23.05";
    nixpkgs-unstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    devenv.url = "github:cachix/devenv";
    nix2container.url = "github:nlewo/nix2container";
    nix2container.inputs.nixpkgs.follows = "nixpkgs";
    mk-shell-bin.url = "github:rrbutani/nix-mk-shell-bin";
  };

  outputs = inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [
        inputs.devenv.flakeModule
      ];
      systems = [ "x86_64-linux" "i686-linux" "x86_64-darwin" "aarch64-linux" "aarch64-darwin" ];

      perSystem = { config, self', inputs', pkgs, system, ... }: {
        _module.args.pkgs = import inputs.nixpkgs {
          inherit system;
          overlays = [
            (final: prev: {
              unstable = inputs.nixpkgs-unstable.legacyPackages."${system}";
            })
          ];
          config = { };
        };

        devenv.shells.default = {
          languages.javascript.enable = true;

          imports = [ ];

          env = {
            ROARR_LOG = "true";
          };

          scripts = let
            newtree = ''
              set -e
              if git worktree list | grep gitopskdiffmaster &> /dev/null; then
                cd /tmp/gitopskdiffmaster
                git fetch
                git checkout origin/master &> /dev/null
                cd - > /dev/null
              else
                git fetch
                git worktree add /tmp/gitopskdiffmaster origin/master &> /dev/null
              fi
            '';
          in {
            # Useful for diffing an application's generated resources after
            # local changes.
            # Takes a relative path, checkes out master in a temp folder, then
            # does `kustomize build` against the same relative path from master
            # and the current directory before dyffing the output.
            kdiff.exec = ''
              ${newtree}
              >&2 echo diffing `pwd`/$1 with master/$1
              ${pkgs.dyff}/bin/dyff between --ignore-order-changes --truecolor on --omit-header \
                <(kustomize build --enable-helm /tmp/gitopskdiffmaster/$1) \
                <(kustomize build --enable-helm `pwd`/$1)
            '';
            # Automated kdiff on file changes.
            # Takes two directories, watches the first for any yaml file
            # changes, calls `kdiff` on the second any time a change
            # is detected.
            kdiffwatch.exec = ''
              ${pkgs.watchexec}/bin/watchexec -e yaml -w $1 kdiff $2
            '';
            # Similar to kdiff, but for all the resources in cluster
            # Takes the name of a cluster, checks out master to a temp folder,
            # then generates and dyffs the resources for the cluster at master
            # and the cluster in the local directory.
            cdiff.exec = ''
              ${newtree}
              >&2 echo diffing `pwd`/clusters/$1 with master/clusters/$1
              ${pkgs.dyff}/bin/dyff between --color on --ignore-order-changes --truecolor on --omit-header \
                <(kustomize build /tmp/gitopskdiffmaster/clusters/$1 | yq '.spec.source.path' -r | tr '\n' '\0' | xargs -0i -n 1 bash -c 'kustomize build --enable-helm /tmp/gitopskdiffmaster/{} 2>&1; echo "---"') \
                <(kustomize build clusters/$1 | yq '.spec.source.path' -r | tr '\n' '\0' | xargs -0i -n 1 bash -c 'kustomize build --enable-helm {} 2>&1; echo "---"')
            '';
            cdiffreport.exec = ''
              cdiff $1 | ${pkgs.aha}/bin/aha 
            '';
          };

          packages = with pkgs;[
            k9s
            kubectl
            # Need 5.3 for kubeVersion in helmchartinflator
            unstable.kustomize
            kubernetes-helm
            (google-cloud-sdk.withExtraComponents [
              google-cloud-sdk.components.gke-gcloud-auth-plugin
            ])
          ];
        };

      };
    };
}
