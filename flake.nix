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

          scripts = {
            kdiff.exec = ''
              set -e
              git fetch
              if git worktree list | grep gitopskdiffmaster; then
                git worktree remove /tmp/gitopskdiffmaster
              fi
              git worktree add /tmp/gitopskdiffmaster origin/master
              echo diffing `pwd`/$1 with master/$1
              ${pkgs.dyff}/bin/dyff between --omit-header <(kustomize build --enable-helm /tmp/gitopskdiffmaster/$1) <(kustomize build --enable-helm `pwd`/$1)
            '';
            kdiffwatch.exec = ''
              ${pkgs.watchexec}/bin/watchexec -e yaml -w $1 kdiff $2
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
